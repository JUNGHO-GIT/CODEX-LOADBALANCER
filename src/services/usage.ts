import type { Settings } from "../assets/scripts/config.ts";
import { decryptToken } from "../assets/scripts/crypto.ts";
import { errorContext, type Logger } from "../assets/scripts/logger.ts";
import type { Account, UsagePayload } from "../assets/type/domain/common.ts";
import type { Store } from "../repositories/store.ts";
import { applyAccountPlanPolicy, extractPlanType, FREE_PLAN_DEACTIVATION_REASON, isBalancerExcludedAccount, shouldReevaluateFreePlanAccount } from "./account-policy.ts";
import { ensureFreshAccount, shouldRefresh } from "./auth.ts";

// 1. Usage fetch error ―――――――――――――――――――――――――――――――――――――――――――――――――――――
export class UsageFetchError extends Error {
  statusCode: number;
  code: string | null;
  planType: string | null;

  // 1-1. Error create
  constructor(statusCode: number, message: string, code: string | null, planType: string | null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.planType = planType;
  }
}

// 2. Usage fetch ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function fetchUsage(accessToken: string, accountId: string | null, settings: Settings): Promise<UsagePayload> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
  };
  if (accountId !== null) {
    headers["chatgpt-account-id"] = accountId;
  }
  const response = await fetch(`${settings.upstreamBaseUrl.replace(/\/$/, "")}/wham/usage`, { headers });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new UsageFetchError(response.status, extractMessage(payload) ?? `Usage fetch failed (${response.status})`, extractCode(payload), extractPlanType(payload));
  }
  return payload as UsagePayload;
}

// 3. Usage apply ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function refreshUsage(account: Account, store: Store, encryptionKey: Buffer, settings: Settings, logger?: Logger): Promise<Account> {
  let current = await ensureFreshAccount(account, store, settings, encryptionKey, false, logger);
  let accessToken = decryptToken(current.accessTokenEncrypted, encryptionKey);
  let payload: UsagePayload;
  try {
    payload = await fetchUsage(accessToken, current.chatgptAccountId, settings);
  } catch (error) {
    if (!shouldRetryUsage(error)) {
      throw error;
    }
    current = await ensureFreshAccount(current, store, settings, encryptionKey, true, logger);
    accessToken = decryptToken(current.accessTokenEncrypted, encryptionKey);
    payload = await fetchUsage(accessToken, current.chatgptAccountId, settings);
  }
  const primary = payload.rate_limit?.primary_window;
  const secondary = payload.rate_limit?.secondary_window;
  const updated = applyAccountPlanPolicy(
    {
      ...current,
      planType: payload.plan_type ?? current.planType,
      usedPercent: typeof primary?.used_percent === "number" ? primary.used_percent : current.usedPercent,
      secondaryUsedPercent: typeof secondary?.used_percent === "number" ? secondary.used_percent : current.secondaryUsedPercent,
      resetAt: typeof primary?.reset_at === "number" ? primary.reset_at : typeof secondary?.reset_at === "number" ? secondary.reset_at : current.resetAt,
    },
    settings.autoDisableFreePlan,
  );
  await store.upsertAccount(updated);
  return updated;
}

// 3-1. Usage polling ―――――――――――――――――――――――――――――――――――――――――――――――――――――
// 부팅 후 주기적으로 active 계정의 사용량 창(primary/secondary)을 갱신해
// balancer가 정확한 usedPercent/resetAt을 기반으로 정렬할 수 있게 한다.
// 실패는 warn 로그만 남기고 다음 tick으로 넘어간다.
export type UsagePollingHandle = {
  stop(): void;
};

type UsagePollingState = {
  failureCount: number;
  nextAttemptAt: number;
  stage: PollingStage;
};

type PollingStage = "usage" | "interval_refresh";

type UsagePollingPlan = {
  usageCandidates: Account[];
  intervalRefreshCandidates: Account[];
};

export function startUsagePolling(store: Store, settings: Settings, encryptionKey: Buffer, logger: Logger): UsagePollingHandle {
  const intervalMs = Math.max(60, settings.usagePollIntervalSeconds) * 1000;
  const concurrencyLimit = Math.max(1, settings.usagePollConcurrency);
  const jitterMs = Math.max(0, settings.usagePollJitterMs);
  const states = new Map<string, UsagePollingState>();
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
      const accounts = await store.listAccounts();
      const now = Date.now();
      const plan = buildUsagePollingPlan(accounts, settings, states, now);
      logger.debug("usage_poll.tick_planned", {
        usageCandidates: plan.usageCandidates.length,
        intervalRefreshCandidates: plan.intervalRefreshCandidates.length,
      });
      await runPollingStageBatches(
        plan.usageCandidates,
        concurrencyLimit,
        () => stopped,
        (account) => refreshUsageWithBackoff(account, store, encryptionKey, settings, logger, states, jitterMs),
      );
      await runPollingStageBatches(
        plan.intervalRefreshCandidates,
        concurrencyLimit,
        () => stopped,
        (account) => refreshAccountIntervalWithBackoff(account, store, encryptionKey, settings, logger, states, jitterMs),
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
  // 첫 tick을 즉시 시작하지 않고, 서버 부팅 직후 몰림을 피해 10초 후 실행
  const kickoff = setTimeout(() => {
    void tick();
  }, 10_000);
  if (typeof (kickoff as { unref?: () => void }).unref === "function") {
    (kickoff as { unref: () => void }).unref();
  }
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(kickoff);
    },
  };
}

// 3-2. Usage polling plan build
export function buildUsagePollingPlan(accounts: Account[], settings: Pick<Settings, "tokenRefreshIntervalDays">, states: ReadonlyMap<string, UsagePollingState>, now: number = Date.now()): UsagePollingPlan {
  const nowDate = new Date(now);
  const usageCandidates: Account[] = [];
  const intervalRefreshCandidates: Account[] = [];
  for (const account of accounts) {
    if ((states.get(account.id)?.nextAttemptAt ?? 0) > now) {
      continue;
    }
    if (isUsagePollingCandidate(account)) {
      usageCandidates.push(account);
      continue;
    }
    if (isIntervalRefreshCandidate(account, settings.tokenRefreshIntervalDays, nowDate)) {
      intervalRefreshCandidates.push(account);
    }
  }
  return {
    usageCandidates,
    intervalRefreshCandidates,
  };
}

// 3-3. Usage polling candidate check
export function isUsagePollingCandidate(account: Account): boolean {
  return account.status === "active" && !isBalancerExcludedAccount(account);
}

// 3-4. Interval refresh candidate check
export function isIntervalRefreshCandidate(account: Account, intervalDays: number, now: Date = new Date()): boolean {
  if (!shouldReevaluateFreePlanAccount(account)) {
    return false;
  }
  if (account.status === "paused") {
    return false;
  }
  if (account.status === "deactivated" && account.deactivationReason !== FREE_PLAN_DEACTIVATION_REASON) {
    return false;
  }
  return shouldRefresh(account, intervalDays, now);
}

// 3-5. Polling stage batches run
async function runPollingStageBatches(accounts: Account[], size: number, isStopped: () => boolean, runner: (account: Account) => Promise<void>): Promise<void> {
  if (isStopped() || accounts.length === 0) {
    return;
  }
  const batches = chunkAccounts(accounts, size);
  for (const batch of batches) {
    if (isStopped()) {
      break;
    }
    await Promise.all(batch.map((account) => runner(account)));
  }
}

// 3-6. Usage refresh with backoff
async function refreshUsageWithBackoff(account: Account, store: Store, encryptionKey: Buffer, settings: Settings, logger: Logger, states: Map<string, UsagePollingState>, jitterMs: number): Promise<void> {
  try {
    await refreshUsage(account, store, encryptionKey, settings, logger);
    states.delete(account.id);
    logger.debug("usage_poll.updated", { accountId: account.id });
  } catch (error) {
    const current = states.get(account.id) ?? { failureCount: 0, nextAttemptAt: 0, stage: "usage" as const };
    const failureCount = current.failureCount + 1;
    const retryInMs = usageBackoffMs(failureCount) + randomJitterMs(jitterMs);
    states.set(account.id, {
      failureCount,
      nextAttemptAt: Date.now() + retryInMs,
      stage: "usage",
    });
    logger.warn("usage_poll.failed", {
      accountId: account.id,
      stage: "usage",
      failureCount,
      retryInMs,
      ...errorContext(error),
    });
  }
}

// 3-7. Interval refresh with backoff
async function refreshAccountIntervalWithBackoff(account: Account, store: Store, encryptionKey: Buffer, settings: Settings, logger: Logger, states: Map<string, UsagePollingState>, jitterMs: number): Promise<void> {
  try {
    const refreshed = await ensureFreshAccount(account, store, settings, encryptionKey, false, logger);
    states.delete(account.id);
    logger.debug("usage_poll.interval_refresh_updated", {
      accountId: account.id,
      planType: refreshed.planType,
      status: refreshed.status,
    });
  } catch (error) {
    const current = states.get(account.id) ?? { failureCount: 0, nextAttemptAt: 0, stage: "interval_refresh" as const };
    const failureCount = current.failureCount + 1;
    const retryInMs = usageBackoffMs(failureCount) + randomJitterMs(jitterMs);
    states.set(account.id, {
      failureCount,
      nextAttemptAt: Date.now() + retryInMs,
      stage: "interval_refresh",
    });
    logger.warn("usage_poll.interval_refresh_failed", {
      accountId: account.id,
      stage: "interval_refresh",
      failureCount,
      retryInMs,
      ...errorContext(error),
    });
  }
}

// 3-8. Account chunk
function chunkAccounts(accounts: Account[], size: number): Account[][] {
  const batches: Account[][] = [];
  for (const [index, account] of accounts.entries()) {
    const batchIndex = Math.floor(index / size);
    const batch = batches[batchIndex];
    if (batch === undefined) {
      batches[batchIndex] = [account];
    } else {
      batch.push(account);
    }
  }
  return batches;
}

// 3-9. Usage backoff
function usageBackoffMs(failureCount: number): number {
  return Math.min(300_000, 30_000 * 2 ** Math.min(failureCount - 1, 4));
}

// 3-10. Random jitter
function randomJitterMs(maxMs: number): number {
  return maxMs <= 0 ? 0 : Math.floor(Math.random() * maxMs);
}

// 4. Error extract ――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// 4-1. Error code
function extractCode(payload: Record<string, unknown>): string | null {
  const error = payload.error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

// 4-2. Error message
function extractMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as Record<string, unknown>).message;
    return typeof message === "string" ? message : null;
  }
  return typeof payload.message === "string" ? payload.message : null;
}

// 4-3. Retry check
function shouldRetryUsage(error: unknown): boolean {
  if (!(error instanceof UsageFetchError)) {
    return false;
  }
  if (error.statusCode === 401 || error.statusCode === 403) {
    return true;
  }
  return error.message.toLowerCase().includes("invalidated");
}
