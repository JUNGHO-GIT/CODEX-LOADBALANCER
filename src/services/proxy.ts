import { createHash } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { Settings } from "../assets/scripts/config.ts";
import { decryptToken } from "../assets/scripts/crypto.ts";
import { errorContext, type Logger } from "../assets/scripts/logger.ts";
import type { Account, ProxyErrorPayload } from "../assets/type/domain/common.ts";
import type { Store } from "../repositories/store.ts";
import { ensureFreshAccount, RefreshError } from "./auth.ts";
import {
  detectSharedResetEpoch,
  FALLBACK_HIGH_CAPABILITY_MODEL,
  filterAccountsForModel,
  isKnownUnsupportedModel,
  markRateLimited,
  PREFERRED_HIGH_CAPABILITY_MODEL,
  rankAccounts,
  recordModelUnsupported,
  recordSuccess,
  recordSupportedModels,
  recordTransientError,
} from "./balancer.ts";
import { importCodexAuthDirectory } from "./codex-auth.ts";

export type ProxyContext = {
  settings: Settings;
  store: Store;
  encryptionKey: Buffer;
  logger: Logger;
  upstreamBase: string;
};

type AttemptSuccess = {
  account: Account;
  response: Response;
  retried: boolean;
};

type RaceOutcome =
  | { kind: "winner"; winner: AttemptSuccess }
  | {
      kind: "exhausted";
      lastRateLimit: RateLimitInfo | null;
      lastError: unknown;
      resetEpochs: number[];
    };

type RateLimitInfo = {
  status: number;
  headers: Headers;
  body: Buffer;
  retryAfterSeconds: number;
  resetAtEpoch: number | null;
};

type RequestIntent = {
  isModelsRequest: boolean;
  requestedModel: string | null;
  reasoningEffort: string | null;
  fallbackModel: string | null;
};

type ProxyPassResult =
  | {
      kind: "success";
      mode: "primary" | "parallel";
      outcome: AttemptSuccess;
      prepared: PreparedRequest;
    }
  | {
      kind: "rate_limited";
      lastRateLimit: RateLimitInfo;
      resetEpochs: number[];
    }
  | {
      kind: "failed";
      lastError: unknown;
      resetEpochs: number[];
    };

type PreparedRequest = {
  body: Buffer;
  requestedModel: string | null;
  reasoningEffort: string | null;
  usedFallback: boolean;
};

// 0. Model unsupported error ―――――――――――――――――――――――――――――――――――――――――――――――――――
export class AccountModelUnsupportedError extends Error {
  code: string;
  model: string;

  // 0-1. Error create
  constructor(model: string, message: string, code = "model_not_supported") {
    super(message);
    this.code = code;
    this.model = model;
  }
}

// 0-1. Request body too large error
class RequestBodyTooLargeError extends Error {
  maxBytes: number;

  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.maxBytes = maxBytes;
  }
}

// Token decryption cache: one entry per account, invalidated when the stored
// ciphertext rotates (refresh). Avoids GCM decrypt on every upstream call.
const tokenCache = new Map<string, { encrypted: string; plain: string }>();

// 1. Proxy request ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function proxyRequest(req: IncomingMessage, res: ServerResponse, ctx: ProxyContext): Promise<void> {
  if (!(await validateApiKey(req.headers, ctx))) {
    ctx.logger.warn("proxy.auth_rejected", { reason: "invalid_api_key" });
    writeJson(res, 401, openaiError("invalid_api_key", "Invalid API key", "invalid_request_error"));
    return;
  }
  if (ctx.settings.globalCooldownEnabled) {
    const shortCircuit = await shortCircuitGlobalCooldown(ctx);
    if (shortCircuit !== null) {
      writeJson(res, 429, shortCircuit.payload);
      ctx.logger.warn("proxy.global_cooldown_short_circuit", {
        retryAfterSeconds: shortCircuit.retryAfterSeconds,
        reason: shortCircuit.reason,
      });
      return;
    }
  }
  const path = requestPath(req.url ?? "/");
  if (contentLengthExceedsLimit(req, ctx.settings.proxyMaxBodyBytes)) {
    req.resume();
    ctx.logger.warn("proxy.request_body_too_large", {
      maxBytes: ctx.settings.proxyMaxBodyBytes,
    });
    writeJson(
      res,
      413,
      openaiError(
        "request_body_too_large",
        `Request body exceeds ${ctx.settings.proxyMaxBodyBytes} bytes`,
        "invalid_request_error",
      ),
    );
    return;
  }
  let body: Buffer;
  try {
    body = await readBody(req, ctx.settings.proxyMaxBodyBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      req.resume();
      ctx.logger.warn("proxy.request_body_too_large", {
        maxBytes: error.maxBytes,
      });
      writeJson(res, 413, openaiError("request_body_too_large", error.message, "invalid_request_error"));
      return;
    }
    throw error;
  }
  const intent = requestIntent(path, body, req.headers);
  const accounts = await ctx.store.listAccounts();
  const ranked = rankAccounts(accounts, Date.now() / 1000, {
    requestedModel: intent.requestedModel,
    preferredModel: PREFERRED_HIGH_CAPABILITY_MODEL,
    fallbackModel: FALLBACK_HIGH_CAPABILITY_MODEL,
  });
  if (intent.isModelsRequest) {
    await proxyModelsRequest(ranked, req, body, res, ctx);
    return;
  }
  const candidates = intent.requestedModel === null ? ranked : filterAccountsForModel(ranked, intent.requestedModel);
  if (candidates.length === 0) {
    const fallbackHandled = await tryPreferredModelFallback(req, res, ctx, accounts, body, intent, "no_preferred_ready_accounts");
    if (fallbackHandled) {
      return;
    }
    if (intent.requestedModel !== null) {
      ctx.logger.warn("proxy.model_unavailable", {
        model: intent.requestedModel,
        accountCount: accounts.length,
      });
      writeJson(
        res,
        400,
        openaiError(
          "model_not_supported",
          `No active account currently supports '${intent.requestedModel}'`,
          "invalid_request_error",
        ),
      );
      return;
    }
    ctx.logger.warn("proxy.account_unavailable", {
      reason: "No active accounts available",
      accountCount: accounts.length,
    });
    writeJson(res, 503, openaiError("no_accounts", "No active accounts available", "server_error"));
    return;
  }
  const initialResult = await executeProxyPass(candidates, req, createPreparedRequest(body, req.headers, intent.requestedModel, false), ctx);
  if (await writeProxyPassResult(initialResult, res, ctx)) {
    return;
  }
  if (initialResult.kind !== "failed") {
    return;
  }
  const fallbackHandled = await tryPreferredModelFallback(
    req,
    res,
    ctx,
    await ctx.store.listAccounts(),
    body,
    intent,
    fallbackReason(initialResult.lastError),
  );
  if (fallbackHandled) {
    return;
  }
  if (initialResult.lastError instanceof AccountModelUnsupportedError) {
    writeJson(res, 400, openaiError(initialResult.lastError.code, initialResult.lastError.message, "invalid_request_error"));
    return;
  }
  ctx.logger.error("proxy.request_failed", { ...errorContext(initialResult.lastError) });
  writeJson(res, 502, openaiError("upstream_unavailable", errorMessage(initialResult.lastError), "server_error"));
}

// 1-0-0. Content length limit check
function contentLengthExceedsLimit(req: IncomingMessage, maxBytes: number): boolean {
  const raw = req.headers["content-length"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const size = Number.parseInt(value ?? "", 10);
  return Number.isFinite(size) && size > maxBytes;
}

// 1-0. Global cooldown short-circuit ―――――――――――――――――――――――――――――――――――――
async function shortCircuitGlobalCooldown(ctx: ProxyContext): Promise<{
  payload: ProxyErrorPayload;
  retryAfterSeconds: number;
  reason: string;
} | null> {
  const meta = await ctx.store.getMeta();
  if (meta.globalCooldownUntil === null) {
    return null;
  }
  const nowSeconds = Date.now() / 1000;
  if (meta.globalCooldownUntil <= nowSeconds) {
    await ctx.store.setMeta({
      globalCooldownUntil: null,
      globalCooldownReason: null,
    });
    return null;
  }
  const retryAfterSeconds = Math.max(1, Math.floor(meta.globalCooldownUntil - nowSeconds));
  return {
    payload: {
      error: {
        code: "usage_limit_reached",
        message: `Shared account quota cooldown active for ${retryAfterSeconds}s`,
        type: "rate_limit_error",
      },
    },
    retryAfterSeconds,
    reason: meta.globalCooldownReason ?? "shared_reset_epoch",
  };
}

// 1-0-1. Global cooldown record ――――――――――――――――――――――――――――――――――――――――
async function maybeRecordGlobalCooldown(resetEpochs: number[], ctx: ProxyContext): Promise<void> {
  if (!ctx.settings.globalCooldownEnabled) {
    return;
  }
  const shared = detectSharedResetEpoch(resetEpochs);
  if (shared === null) {
    return;
  }
  await ctx.store.setMeta({
    globalCooldownUntil: shared,
    globalCooldownReason: "shared_reset_epoch_detected",
  });
  ctx.logger.warn("proxy.global_cooldown_recorded", {
    globalCooldownUntil: shared,
    observedAccounts: resetEpochs.length,
  });
}

// 1-0-2. Proxy pass execute ――――――――――――――――――――――――――――――――――――――――――――――――――
async function executeProxyPass(candidates: Account[], req: IncomingMessage, prepared: PreparedRequest, ctx: ProxyContext): Promise<ProxyPassResult> {
  const best = candidates[0] ?? null;
  if (best === null) {
    return {
      kind: "failed",
      lastError: new Error("No active accounts available"),
      resetEpochs: [],
    };
  }
  let lastRateLimit: RateLimitInfo | null = null;
  let lastError: unknown = null;
  const resetEpochs: number[] = [];
  const remaining = candidates.slice(1);
  ctx.logger.info("proxy.account_selected", {
    ...accountUsageLogContext(best, prepared),
    candidateCount: candidates.length,
    mode: "primary",
    requestedModel: prepared.requestedModel,
    usedFallback: prepared.usedFallback ? true : undefined,
  });
  try {
    const outcome = await attemptAccount(best, req, prepared.body, ctx, prepared.requestedModel);
    if (outcome.response.status === 429) {
      const info = await readRateLimit(outcome.response);
      await ctx.store.upsertAccount(markRateLimited(outcome.account, info.retryAfterSeconds));
      lastRateLimit = info;
      if (info.resetAtEpoch !== null) {
        resetEpochs.push(info.resetAtEpoch);
      }
      ctx.logger.warn("proxy.upstream_rate_limited", {
        ...accountUsageLogContext(outcome.account, prepared),
        retryAfterSeconds: info.retryAfterSeconds,
        retried: outcome.retried ? true : undefined,
        remainingCandidates: remaining.length,
        mode: "primary",
        requestedModel: prepared.requestedModel,
        usedFallback: prepared.usedFallback ? true : undefined,
        bodyPreview: info.body.toString("utf8").slice(0, 300),
      });
    } else {
      return {
        kind: "success",
        mode: "primary",
        outcome,
        prepared,
      };
    }
  } catch (error) {
    lastError = error;
    await handleAttemptError(best, error, ctx, remaining.length, "primary");
  }
  if (remaining.length > 0) {
    const race = await raceAccounts(remaining, req, prepared.body, ctx, prepared.requestedModel);
    if (race.kind === "winner") {
      return {
        kind: "success",
        mode: "parallel",
        outcome: race.winner,
        prepared,
      };
    }
    if (race.lastRateLimit !== null) {
      lastRateLimit = race.lastRateLimit;
    }
    if (race.lastError !== null) {
      lastError = race.lastError;
    }
    for (const epoch of race.resetEpochs) {
      resetEpochs.push(epoch);
    }
  }
  if (lastRateLimit !== null) {
    return {
      kind: "rate_limited",
      lastRateLimit,
      resetEpochs,
    };
  }
  return {
    kind: "failed",
    lastError,
    resetEpochs,
  };
}

// 1-0-3. Proxy pass result write
async function writeProxyPassResult(result: ProxyPassResult, res: ServerResponse, ctx: ProxyContext): Promise<boolean> {
  if (result.kind === "success") {
    await ctx.store.upsertAccount(recordSuccess(result.outcome.account));
    ctx.logger.info("proxy.request_succeeded", {
      ...accountUsageLogContext(result.outcome.account, result.prepared),
      statusCode: result.outcome.response.status,
      retried: result.outcome.retried ? true : undefined,
      mode: result.mode,
    });
    await pipeFetchResponse(result.outcome.response, res);
    return true;
  }
  if (result.kind === "rate_limited") {
    await maybeRecordGlobalCooldown(result.resetEpochs, ctx);
    ctx.logger.warn("proxy.all_accounts_rate_limited", {
      retryAfterSeconds: result.lastRateLimit.retryAfterSeconds,
    });
    writeBufferedResponse(res, result.lastRateLimit);
    return true;
  }
  return false;
}

// 1-0-4. Preferred model fallback
async function tryPreferredModelFallback(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ProxyContext,
  accounts: Account[],
  body: Buffer,
  intent: RequestIntent,
  reason: string,
): Promise<boolean> {
  if (intent.requestedModel !== PREFERRED_HIGH_CAPABILITY_MODEL || intent.fallbackModel === null) {
    return false;
  }
  const rewrittenBody = rewriteRequestModel(body, req.headers, intent.fallbackModel);
  if (rewrittenBody === null) {
    return false;
  }
  const ranked = rankAccounts(accounts, Date.now() / 1000, {
    requestedModel: intent.fallbackModel,
    preferredModel: intent.fallbackModel,
    fallbackModel: intent.fallbackModel,
  });
  const candidates = filterAccountsForModel(ranked, intent.fallbackModel);
  if (candidates.length === 0) {
    return false;
  }
  ctx.logger.info("proxy.model_fallback_applied", {
    fromModel: intent.requestedModel,
    toModel: intent.fallbackModel,
    reason,
    candidateCount: candidates.length,
  });
  const fallbackResult = await executeProxyPass(
    candidates,
    req,
    createPreparedRequest(rewrittenBody, req.headers, intent.fallbackModel, true),
    ctx,
  );
  if (await writeProxyPassResult(fallbackResult, res, ctx)) {
    return true;
  }
  if (fallbackResult.kind !== "failed") {
    return true;
  }
  if (fallbackResult.lastError instanceof AccountModelUnsupportedError) {
    writeJson(res, 400, openaiError(fallbackResult.lastError.code, fallbackResult.lastError.message, "invalid_request_error"));
    return true;
  }
  ctx.logger.error("proxy.request_failed", { ...errorContext(fallbackResult.lastError) });
  writeJson(res, 502, openaiError("upstream_unavailable", errorMessage(fallbackResult.lastError), "server_error"));
  return true;
}

// 1-0-5. Prepared request create
function createPreparedRequest(
  body: Buffer,
  headers: IncomingHttpHeaders,
  requestedModel: string | null,
  usedFallback: boolean,
): PreparedRequest {
  return {
    body,
    requestedModel,
    reasoningEffort: extractReasoningEffort(parseRequestJson(body, headers)),
    usedFallback,
  };
}

// 1-0-6. Fallback reason
function fallbackReason(error: unknown): string {
  if (error instanceof AccountModelUnsupportedError) {
    return "preferred_model_rejected";
  }
  return "preferred_model_unavailable";
}

// 1-1. Attempt a single account (401 auto-refresh) ――――――――――――――――――――――――
async function attemptAccount(account: Account, req: IncomingMessage, body: Buffer, ctx: ProxyContext, requestedModel: string | null, signal?: AbortSignal): Promise<AttemptSuccess> {
  let response = await sendUpstream(req, body, account, ctx, false, signal);
  if (response.status !== 401) {
    const modelError = requestedModel === null ? null : await parseModelUnsupported(response, requestedModel);
    if (modelError !== null) {
      await discardBody(response);
      throw modelError;
    }
    return { account, response, retried: false };
  }
  signal?.throwIfAborted();
  ctx.logger.warn("proxy.token_refresh_retry", accountUsageLogContext(account));
  const reloaded = await reloadCodexAuthAccount(account, ctx);
  if (reloaded !== null) {
    tokenCache.delete(reloaded.id);
    signal?.throwIfAborted();
    response = await sendUpstream(req, body, reloaded, ctx, true, signal);
    const modelError = requestedModel === null ? null : await parseModelUnsupported(response, requestedModel);
    if (modelError !== null) {
      await discardBody(response);
      throw modelError;
    }
    return { account: reloaded, response, retried: true };
  }
  if (isCodexAuthAccount(account) && ctx.settings.codexAuthDir !== null) {
    throw new RefreshError("codex_auth_stale", "Codex auth file did not provide a fresh token", false);
  }
  const refreshed = await ensureFreshAccount(account, ctx.store, ctx.settings, ctx.encryptionKey, true, ctx.logger);
  tokenCache.delete(refreshed.id);
  signal?.throwIfAborted();
  response = await sendUpstream(req, body, refreshed, ctx, true, signal);
  const modelError = requestedModel === null ? null : await parseModelUnsupported(response, requestedModel);
  if (modelError !== null) {
    await discardBody(response);
    throw modelError;
  }
  return { account: refreshed, response, retried: true };
}

// 1-1-1. Codex auth account reload
async function reloadCodexAuthAccount(account: Account, ctx: ProxyContext): Promise<Account | null> {
  if (!isCodexAuthAccount(account) || ctx.settings.codexAuthDir === null) {
    return null;
  }
  const imported = await importCodexAuthDirectory(
    ctx.settings.codexAuthDir,
    ctx.store,
    ctx.encryptionKey,
    ctx.settings.autoDisableFreePlan,
    ctx.logger,
  );
  if (imported === 0) {
    return null;
  }
  const stored = await ctx.store.getAccount(account.id);
  if (
    stored === null ||
    stored.status !== "active" ||
    (
      stored.accessTokenEncrypted === account.accessTokenEncrypted &&
      stored.refreshTokenEncrypted === account.refreshTokenEncrypted &&
      stored.idTokenEncrypted === account.idTokenEncrypted
    )
  ) {
    return null;
  }
  ctx.logger.info("codex_auth.account_reloaded", accountUsageLogContext(stored));
  return stored;
}

// 1-1-2. Codex auth account check
function isCodexAuthAccount(account: Account): boolean {
  return account.id.startsWith("codex-auth-");
}

// 1-2. Parallel race across accounts ――――――――――――――――――――――――――――――――――――――
// 계정 간 동시 타격으로 OpenAI의 abuse-detection(동일 IP·계정 스위칭)이
// 가속되는 현상을 완화하기 위해 동시성 N + staggered 지연으로 전환한다.
// "모든 계정 시도 보장" 계약은 유지하므로 최종적으로 모두 시도된다.
async function raceAccounts(accounts: Account[], req: IncomingMessage, body: Buffer, ctx: ProxyContext, requestedModel: string | null): Promise<RaceOutcome> {
  const controllers = accounts.map(() => new AbortController());
  const concurrencyLimit = Math.max(1, Math.min(ctx.settings.parallelConcurrency, accounts.length));
  const staggerMs = Math.max(0, ctx.settings.parallelStaggerMs);
  let settled = 0;
  let launched = 0;
  let done = false;
  let lastRateLimit: RateLimitInfo | null = null;
  let lastError: unknown = null;
  const resetEpochs: number[] = [];

  return await new Promise<RaceOutcome>((resolve) => {
    const launch = (index: number): void => {
      if (done || index >= accounts.length) {
        return;
      }
      const account = accounts[index];
      const controller = controllers[index];
      if (account === undefined || controller === undefined) {
        return;
      }
      const signal = controller.signal;
      ctx.logger.info("proxy.account_selected", {
        ...accountUsageLogContext(account),
        candidateCount: accounts.length,
        mode: "parallel",
      });
      attemptAccount(account, req, body, ctx, requestedModel, signal)
        .then(async (outcome) => {
          if (done) {
            ctx.logger.debug("proxy.parallel_late_response_discarded", {
              ...accountUsageLogContext(outcome.account),
              statusCode: outcome.response.status,
            });
            await discardBody(outcome.response);
            return;
          }
          if (outcome.response.status === 429) {
            const info = await readRateLimit(outcome.response);
            lastRateLimit = info;
            if (info.resetAtEpoch !== null) {
              resetEpochs.push(info.resetAtEpoch);
            }
            await ctx.store.upsertAccount(markRateLimited(outcome.account, info.retryAfterSeconds));
            ctx.logger.warn("proxy.upstream_rate_limited", {
              ...accountUsageLogContext(outcome.account),
              retryAfterSeconds: info.retryAfterSeconds,
              retried: outcome.retried ? true : undefined,
              mode: "parallel",
              bodyPreview: info.body.toString("utf8").slice(0, 300),
            });
            return;
          }
          done = true;
          const abortedCount = abortOtherAttempts(controllers, index);
          ctx.logger.debug("proxy.parallel_cancelled", {
            ...accountUsageLogContext(outcome.account),
            abortedCount,
          });
          resolve({ kind: "winner", winner: outcome });
        })
        .catch(async (error) => {
          if (signal.aborted) {
            ctx.logger.debug("proxy.parallel_attempt_aborted", {
              ...accountUsageLogContext(account),
            });
            return;
          }
          lastError = error;
          await handleAttemptError(account, error, ctx, accounts.length - settled - 1, "parallel");
        })
        .finally(() => {
          settled += 1;
          if (done) {
            return;
          }
          if (launched < accounts.length) {
            launch(launched);
            launched += 1;
          } else if (settled === accounts.length) {
            done = true;
            resolve({ kind: "exhausted", lastRateLimit, lastError, resetEpochs });
          }
        });
    };

    const initial = Math.min(concurrencyLimit, accounts.length);
    for (let i = 0; i < initial; i += 1) {
      if (i === 0 || staggerMs === 0) {
        launch(i);
      } else {
        setTimeout(() => {
          if (!done) {
            launch(i);
          }
        }, staggerMs * i);
      }
    }
    launched = initial;
  });
}

// 1-2-1. Other attempts abort
function abortOtherAttempts(controllers: AbortController[], winnerIndex: number): number {
  let abortedCount = 0;
  controllers.forEach((controller, index) => {
    if (index !== winnerIndex && !controller.signal.aborted) {
      controller.abort();
      abortedCount += 1;
    }
  });
  return abortedCount;
}

// 1-3. Error bookkeeping ――――――――――――――――――――――――――――――――――――――――――――――――
async function handleAttemptError(account: Account, error: unknown, ctx: ProxyContext, remainingCandidates: number, mode: "primary" | "parallel" | "models"): Promise<void> {
  if (error instanceof RefreshError && error.permanent) {
    ctx.logger.warn("proxy.permanent_refresh_failure", {
      ...accountUsageLogContext(account),
      code: error.code,
      message: error.message,
      remainingCandidates,
      mode,
    });
    return;
  }
  if (error instanceof AccountModelUnsupportedError) {
    await ctx.store.upsertAccount(recordModelUnsupported(account, error.model));
    ctx.logger.warn("proxy.model_unsupported", {
      ...accountUsageLogContext(account),
      model: error.model,
      code: error.code,
      message: error.message,
      remainingCandidates,
      mode,
    });
    return;
  }
  await ctx.store.upsertAccount(recordTransientError(account));
  ctx.logger.error("proxy.account_attempt_failed", {
    ...accountUsageLogContext(account),
    remainingCandidates,
    mode,
    ...errorContext(error),
  });
}

// 1-4. Discard unused response body ―――――――――――――――――――――――――――――――――――――――
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // body may already be closed due to abort
  }
}

// 1-5. Rate-limit read ――――――――――――――――――――――――――――――――――――――――――――――――――――
async function readRateLimit(response: Response): Promise<RateLimitInfo> {
  const body = Buffer.from(await response.arrayBuffer());
  let retryAfterSeconds = 0;
  let resetAtEpoch: number | null = null;
  const retryHeader = response.headers.get("retry-after");
  if (retryHeader !== null) {
    const seconds = Number.parseInt(retryHeader, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      retryAfterSeconds = seconds;
    } else {
      const epoch = Date.parse(retryHeader);
      if (Number.isFinite(epoch)) {
        retryAfterSeconds = Math.max(0, Math.floor((epoch - Date.now()) / 1000));
      }
    }
  }
  try {
    const parsed = JSON.parse(body.toString("utf8")) as {
      error?: {
        resets_in_seconds?: number;
        resets_at?: number;
      } | null;
      rate_limit?: {
        primary_window?: {
          reset_after_seconds?: number;
          reset_at?: number;
        } | null;
        secondary_window?: {
          reset_after_seconds?: number;
          reset_at?: number;
        } | null;
      } | null;
    };
    const codexResets = parsed.error?.resets_in_seconds;
    const codexResetsAt = parsed.error?.resets_at;
    const primary = parsed.rate_limit?.primary_window;
    const secondary = parsed.rate_limit?.secondary_window;
    const seconds = codexResets ?? primary?.reset_after_seconds ?? secondary?.reset_after_seconds;
    if (retryAfterSeconds === 0 && typeof seconds === "number" && seconds > 0) {
      retryAfterSeconds = Math.floor(seconds);
    }
    const resetAt = codexResetsAt ?? primary?.reset_at ?? secondary?.reset_at;
    if (typeof resetAt === "number" && Number.isFinite(resetAt)) {
      resetAtEpoch = Math.floor(resetAt);
      if (retryAfterSeconds === 0) {
        retryAfterSeconds = Math.max(0, Math.floor(resetAt - Date.now() / 1000));
      }
    }
  } catch {
    // body is not structured JSON with rate_limit info
  }
  if (retryAfterSeconds === 0) {
    retryAfterSeconds = 3600;
  }
  if (resetAtEpoch === null) {
    resetAtEpoch = Math.floor(Date.now() / 1000) + retryAfterSeconds;
  }
  return {
    status: response.status,
    headers: response.headers,
    body,
    retryAfterSeconds,
    resetAtEpoch,
  };
}

// 1-6. Buffered response write ――――――――――――――――――――――――――――――――――――――――――――
const STRIPPED_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

function writeBufferedResponse(res: ServerResponse, info: RateLimitInfo): void {
  res.statusCode = info.status;
  info.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });
  res.end(info.body);
}

// 1-7. Models request handle ―――――――――――――――――――――――――――――――――――――――――――――――
async function proxyModelsRequest(accounts: Account[], req: IncomingMessage, body: Buffer, res: ServerResponse, ctx: ProxyContext): Promise<void> {
  if (accounts.length === 0) {
    ctx.logger.warn("proxy.account_unavailable", {
      reason: "No active accounts available",
      accountCount: 0,
    });
    writeJson(res, 503, openaiError("no_accounts", "No active accounts available", "server_error"));
    return;
  }
  let lastRateLimit: RateLimitInfo | null = null;
  let lastError: unknown = null;
  let payloadTemplate: Record<string, unknown> | null = null;
  const models = new Map<string, Record<string, unknown>>();
  for (const account of accounts) {
    ctx.logger.info("proxy.account_selected", {
      ...accountUsageLogContext(account),
      candidateCount: accounts.length,
      mode: "models",
    });
    try {
      const outcome = await attemptAccount(account, req, body, ctx, null);
      if (outcome.response.status === 429) {
        const info = await readRateLimit(outcome.response);
        await ctx.store.upsertAccount(markRateLimited(outcome.account, info.retryAfterSeconds));
        lastRateLimit = info;
        ctx.logger.warn("proxy.upstream_rate_limited", {
          ...accountUsageLogContext(outcome.account),
          retryAfterSeconds: info.retryAfterSeconds,
          retried: outcome.retried ? true : undefined,
          remainingCandidates: accounts.length - models.size - 1,
          mode: "models",
          bodyPreview: info.body.toString("utf8").slice(0, 300),
        });
        continue;
      }
      if (outcome.response.status !== 200) {
        lastError = new Error(`Models upstream returned ${outcome.response.status}`);
        await discardBody(outcome.response);
        continue;
      }
      const payload = await readModelsPayload(outcome.response);
      if (payload !== null) {
        payloadTemplate ??= payload;
        const modelIds = collectModels(payload, models);
        const updated = recordSuccess(recordSupportedModels(outcome.account, modelIds));
        await ctx.store.upsertAccount(updated);
      }
    } catch (error) {
      lastError = error;
      await handleAttemptError(account, error, ctx, accounts.length - 1, "models");
    }
  }
  if (models.size > 0) {
    const payload = payloadTemplate ?? { object: "list" };
    writeJson(res, 200, {
      ...payload,
      data: [...models.values()],
    });
    return;
  }
  if (lastRateLimit !== null) {
    writeBufferedResponse(res, lastRateLimit);
    return;
  }
  if (lastError instanceof AccountModelUnsupportedError) {
    writeJson(res, 400, openaiError(lastError.code, lastError.message, "invalid_request_error"));
    return;
  }
  ctx.logger.error("proxy.request_failed", { ...errorContext(lastError) });
  writeJson(res, 502, openaiError("upstream_unavailable", errorMessage(lastError), "server_error"));
}

// 2. Upstream send ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function sendUpstream(req: IncomingMessage, body: Buffer, account: Account, ctx: ProxyContext, forceRefreshed: boolean, signal?: AbortSignal): Promise<Response> {
  const accessToken = getAccessToken(account, ctx.encryptionKey);
  const headers = upstreamHeaders(req.headers, accessToken, account.chatgptAccountId);
  const url = upstreamUrl(req.url ?? "/", ctx.upstreamBase);
  const method = req.method ?? "GET";
  const requestBody = body.length > 0 && method !== "GET" && method !== "HEAD" ? body : undefined;
  const response = await fetch(url, {
    method,
    headers,
    body: requestBody as BodyInit | undefined,
    signal,
  });
  if (response.status === 401 && forceRefreshed) {
    throw new Error("Upstream rejected refreshed token");
  }
  return response;
}

// 2-1. Token cache ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function getAccessToken(account: Account, key: Buffer): string {
  const cached = tokenCache.get(account.id);
  if (cached && cached.encrypted === account.accessTokenEncrypted) {
    return cached.plain;
  }
  const plain = decryptToken(account.accessTokenEncrypted, key);
  tokenCache.set(account.id, {
    encrypted: account.accessTokenEncrypted,
    plain,
  });
  return plain;
}

// 3. API key check ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function validateApiKey(headers: IncomingHttpHeaders, ctx: ProxyContext): Promise<boolean> {
  if (!ctx.settings.apiKeyAuthEnabled) {
    return true;
  }
  const raw = headers.authorization;
  const authorization = Array.isArray(raw) ? raw[0] : raw;
  const token = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return false;
  }
  const hash = createHash("sha256").update(token).digest("hex");
  const keys = await ctx.store.listApiKeys();
  const now = Date.now();
  return keys.some((key) => key.enabled && key.tokenHash === hash && (key.expiresAt === null || Date.parse(key.expiresAt) > now));
}

// 4. Headers ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
const STRIPPED_REQUEST_HEADERS = new Set(["host", "authorization", "content-length"]);

function upstreamHeaders(headers: IncomingHttpHeaders, accessToken: string, accountId: string | null): Headers {
  const next = new Headers();
  for (const name in headers) {
    const value = headers[name];
    if (value === undefined || STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    next.set(name, Array.isArray(value) ? value.join(", ") : `${value}`);
  }
  next.set("authorization", `Bearer ${accessToken}`);
  if (accountId !== null) {
    next.set("chatgpt-account-id", accountId);
  }
  return next;
}

// 5. URL map ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function upstreamUrl(path: string, base: string): string {
  if (path.startsWith("/v1/")) {
    return `${base}${path}`;
  }
  if (path.startsWith("/backend-api/codex/")) {
    return `${base}${path.slice("/backend-api/codex".length)}`;
  }
  return `${base}${path}`;
}

// 5-1. Request path ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function requestPath(path: string): string {
  return new URL(path, "http://localhost").pathname;
}

// 5-2. Request intent ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function requestIntent(path: string, body: Buffer, headers: IncomingHttpHeaders): RequestIntent {
  const parsed = parseRequestJson(body, headers);
  const requestedModel = extractRequestedModel(parsed);
  return {
    isModelsRequest: path === "/backend-api/codex/models" || path === "/v1/models",
    requestedModel,
    reasoningEffort: extractReasoningEffort(parsed),
    fallbackModel: requestedModel === PREFERRED_HIGH_CAPABILITY_MODEL ? FALLBACK_HIGH_CAPABILITY_MODEL : null,
  };
}

// 5-3. Request JSON parse ―――――――――――――――――――――――――――――――――――――――――――――――
function parseRequestJson(body: Buffer, headers: IncomingHttpHeaders): Record<string, unknown> | null {
  if (body.length === 0) {
    return null;
  }
  try {
    return objectValue(JSON.parse(decodeRequestBody(body, headers).toString("utf8")));
  }
  catch {
    return null;
  }
}

// 5-4. Request body decode
function decodeRequestBody(body: Buffer, headers: IncomingHttpHeaders): Buffer {
  if (requestContentEncoding(headers) === "zstd") {
    return Buffer.from(bunCompression().zstdDecompressSync(body));
  }
  return body;
}

// 5-5. Request body encode
function encodeRequestBody(body: Buffer, headers: IncomingHttpHeaders): Buffer {
  if (requestContentEncoding(headers) === "zstd") {
    return Buffer.from(bunCompression().zstdCompressSync(body));
  }
  return body;
}

// 5-6. Bun compression
function bunCompression(): {
  zstdCompressSync(input: Buffer): Uint8Array;
  zstdDecompressSync(input: Buffer): Uint8Array;
} {
  const bun = (globalThis as typeof globalThis & {
    Bun?: {
      zstdCompressSync(input: Buffer): Uint8Array;
      zstdDecompressSync(input: Buffer): Uint8Array;
    };
  }).Bun;
  if (bun === undefined) {
    throw new Error("Bun zstd compression is unavailable");
  }
  return bun;
}

// 5-7. Request content encoding
function requestContentEncoding(headers: IncomingHttpHeaders): string | null {
  const raw = headers["content-encoding"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined ? null : value.trim().toLowerCase();
}

// 5-8. Requested model extract ―――――――――――――――――――――――――――――――――――――――――――――――
function extractRequestedModel(parsed: Record<string, unknown> | null): string | null {
  return stringValue(parsed?.model);
}

// 5-9. Reasoning effort extract
function extractReasoningEffort(parsed: Record<string, unknown> | null): string | null {
  const reasoning = objectValue(parsed?.reasoning);
  return stringValue(reasoning?.effort) ?? stringValue(parsed?.reasoning_effort);
}

// 5-10. Request model rewrite ――――――――――――――――――――――――――――――――――――――――――――――――――
function rewriteRequestModel(body: Buffer, headers: IncomingHttpHeaders, nextModel: string): Buffer | null {
  const parsed = parseRequestJson(body, headers);
  if (parsed === null) {
    return null;
  }
  const next = {
    ...parsed,
    model: nextModel,
  };
  return encodeRequestBody(Buffer.from(JSON.stringify(next), "utf8"), headers);
}

// 5-6. Models payload read ―――――――――――――――――――――――――――――――――――――――――――――――――――
async function readModelsPayload(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await response.json()) as unknown;
    return objectValue(parsed);
  } catch {
    return null;
  }
}

// 5-7. Models collect ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function collectModels(payload: Record<string, unknown>, target: Map<string, Record<string, unknown>>): string[] {
  const data = Array.isArray(payload.data) ? payload.data : [];
  const modelIds: string[] = [];
  for (const item of data) {
    const record = objectValue(item);
    const modelId = stringValue(record?.id);
    if (record === null || modelId === null) {
      continue;
    }
    modelIds.push(modelId);
    if (!target.has(modelId)) {
      target.set(modelId, record);
    }
  }
  return modelIds;
}

// 5-8. Unsupported model parse ―――――――――――――――――――――――――――――――――――――――――――――
async function parseModelUnsupported(response: Response, requestedModel: string): Promise<AccountModelUnsupportedError | null> {
  if (response.status !== 400 && response.status !== 403) {
    return null;
  }
  const payload = await response.clone().json().catch(() => null) as unknown;
  const record = objectValue(payload);
  const error = objectValue(record?.error);
  const code = stringValue(error?.code) ?? stringValue(record?.code) ?? "model_not_supported";
  const message =
    stringValue(record?.detail) ??
    stringValue(error?.message) ??
    stringValue(record?.message);
  if (message === null) {
    return null;
  }
  const normalized = message.toLowerCase();
  const modelText = requestedModel.toLowerCase();
  if (!normalized.includes(modelText)) {
    return null;
  }
  if (!normalized.includes("not supported") && code !== "model_not_supported") {
    return null;
  }
  return new AccountModelUnsupportedError(requestedModel, message, code);
}

// 5-9. Object value ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

// 5-10. String value ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

// 6. Response pipe ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function pipeFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });
  if (response.body === null) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const item = await reader.read();
    if (item.done) {
      break;
    }
    await writeResponseChunk(res, item.value);
  }
  res.end();
}

// 6-1. Response chunk write
function writeResponseChunk(res: ServerResponse, chunk: Uint8Array): Promise<void> {
  const written = res.write(Buffer.from(chunk));
  if (written) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("close", onClose);
      res.off("drain", onDrain);
      res.off("error", onError);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Client connection closed during response streaming"));
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    res.once("close", onClose);
    res.once("drain", onDrain);
    res.once("error", onError);
  });
}

// 7. Body read ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buf);
    total += buf.length;
    if (total > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
  }
  if (chunks.length === 0) {
    return Buffer.alloc(0);
  }
  if (chunks.length === 1) {
    return chunks[0] ?? Buffer.alloc(0);
  }
  return Buffer.concat(chunks, total);
}

// 8. Error JSON ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// 8-1. OpenAI error
export function openaiError(code: string, message: string, type: string): ProxyErrorPayload {
  return { error: { code, message, type } };
}

// 8-2. JSON write
export function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

// 8-3. Account usage log context
function accountUsageLogContext(account: Account, request?: Pick<PreparedRequest, "requestedModel" | "reasoningEffort">): Record<string, unknown> {
  const usageStatus = request === undefined ? {} : accountUsageStatus(account, request);
  return {
    accountId: account.id,
    accountName: account.email ?? account.id,
    ...usageStatus,
    cooldownUntil: account.cooldownUntil,
  };
}

// 8-4. Account usage status
function accountUsageStatus(account: Account, request: Pick<PreparedRequest, "requestedModel" | "reasoningEffort">): Record<string, string> {
  const model = request.requestedModel ?? "unknown-model";
  const effort = request.reasoningEffort === null ? "" : ` ${request.reasoningEffort}`;
  return {
    modelName: `${model}${effort}`,
    fiveHourRemainingPercent: formatRemainingPercent(account.usedPercent),
    weeklyRemainingPercent: formatRemainingPercent(account.secondaryUsedPercent),
  };
}

// 8-5. Remaining percent format
function formatRemainingPercent(usedPercent: number | null): string {
  const remaining = usageRemainingPercent(usedPercent);
  if (remaining === null) {
    return "unknown";
  }
  const rounded = Math.round(remaining * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

// 8-6. Usage remaining percent
function usageRemainingPercent(usedPercent: number | null): number | null {
  if (usedPercent === null || !Number.isFinite(usedPercent)) {
    return null;
  }
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

// 8-7. Error message
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request to upstream failed";
}
