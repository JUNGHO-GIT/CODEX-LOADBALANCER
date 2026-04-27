import { randomUUID } from "node:crypto";
import type { Settings } from "../assets/scripts/config.ts";
import { decryptToken, encryptToken } from "../assets/scripts/crypto.ts";
import { errorContext, type Logger } from "../assets/scripts/logger.ts";
import type { Account, TokenRefreshResult } from "../assets/type/domain/common.ts";
import type { Store } from "../repositories/store.ts";
import { applyAccountPlanPolicy, extractAccountIdentity } from "./account-policy.ts";

const refreshLocks = new Map<string, Promise<Account>>();

// 1. Refresh error ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export class RefreshError extends Error {
  code: string;
  permanent: boolean;

  // 1-1. Error create
  constructor(code: string, message: string, permanent: boolean) {
    super(message);
    this.code = code;
    this.permanent = permanent;
  }
}

// 2. Refresh timestamp read ――――――――――――――――――――――――――――――――――――――――――――――――――
export function refreshTimestamp(account: Pick<Account, "lastRefresh">): number | null {
  const last = Date.parse(account.lastRefresh);
  return Number.isFinite(last) ? last : null;
}

// 3. Refresh interval ms ――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function refreshIntervalMs(intervalDays: number): number {
  return Math.max(0, intervalDays) * 24 * 60 * 60 * 1000;
}

// 4. Next refresh due at ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function nextRefreshDueAt(account: Pick<Account, "lastRefresh">, intervalDays: number): number | null {
  const last = refreshTimestamp(account);
  if (last === null) {
    return null;
  }
  return last + refreshIntervalMs(intervalDays);
}

// 5. Refresh needed ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function shouldRefresh(account: Account, intervalDays: number, now: Date = new Date()): boolean {
  const dueAt = nextRefreshDueAt(account, intervalDays);
  if (dueAt === null) {
    return true;
  }
  return now.getTime() > dueAt;
}

// 6. Access refresh ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function refreshAccessToken(refreshToken: string, settings: Settings, signal?: AbortSignal): Promise<TokenRefreshResult> {
  const response = await fetch(`${settings.authBaseUrl.replace(/\/$/, "")}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: settings.oauthClientId,
      refresh_token: refreshToken,
      scope: settings.oauthScope,
    }),
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = extractErrorCode(payload) ?? `http_${response.status}`;
    const message = extractErrorMessage(payload) ?? `Token refresh failed (${response.status})`;
    throw new RefreshError(code, message, isPermanentRefreshCode(code));
  }
  const accessToken = stringValue(payload.access_token);
  const nextRefreshToken = stringValue(payload.refresh_token);
  const idToken = stringValue(payload.id_token);
  if (!accessToken || !nextRefreshToken || !idToken) {
    throw new RefreshError("invalid_response", "Refresh response missing tokens", false);
  }
  const identity = extractAccountIdentity({ accessToken, idToken });
  return {
    accessToken,
    refreshToken: nextRefreshToken,
    idToken,
    accountId: identity.chatgptAccountId,
    planType: identity.planType,
    email: identity.email,
  };
}

// 7. Account ensure ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function ensureFreshAccount(account: Account, store: Store, settings: Settings, key: Buffer, force = false, logger?: Logger): Promise<Account> {
  const stored = await readStoredAccount(account, store);
  const current = stored ?? account;
  if (force && stored !== null && stored.refreshTokenEncrypted !== account.refreshTokenEncrypted) {
    logger?.debug("token_refresh.reused_stored", {
      accountId: account.id,
      lastRefresh: stored.lastRefresh,
    });
    return stored;
  }
  if (!force && !shouldRefresh(current, settings.tokenRefreshIntervalDays)) {
    logger?.debug("token_refresh.skipped", {
      accountId: current.id,
      lastRefresh: current.lastRefresh,
    });
    return current;
  }
  const existing = refreshLocks.get(current.id);
  if (existing !== undefined) {
    const waitStartedAt = Date.now();
    logger?.debug("token_refresh.joined", {
      accountId: current.id,
      force,
      lastRefresh: current.lastRefresh,
    });
    const joined = await existing;
    logger?.debug("token_refresh.joined_completed", {
      accountId: current.id,
      waitMs: Date.now() - waitStartedAt,
    });
    return joined;
  }
  const operation = refreshAndStoreAccount(current, store, settings, key, force, logger);
  refreshLocks.set(current.id, operation);
  try {
    return await operation;
  } finally {
    if (refreshLocks.get(current.id) === operation) {
      refreshLocks.delete(current.id);
    }
  }
}

// 7-1. Account refresh
async function refreshAndStoreAccount(account: Account, store: Store, settings: Settings, key: Buffer, force: boolean, logger?: Logger): Promise<Account> {
  logger?.info("token_refresh.started", {
    accountId: account.id,
    force,
    lastRefresh: account.lastRefresh,
  });
  const refreshToken = decryptToken(account.refreshTokenEncrypted, key);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.tokenRefreshTimeoutSeconds * 1000);
  try {
    const result = await refreshAccessToken(refreshToken, settings, controller.signal);
    const nextPlanType = result.planType ?? account.planType;
    const planChanged = nextPlanType !== account.planType;
    const updated = applyAccountPlanPolicy({
      ...account,
      accessTokenEncrypted: encryptToken(result.accessToken, key),
      refreshTokenEncrypted: encryptToken(result.refreshToken, key),
      idTokenEncrypted: encryptToken(result.idToken, key),
      chatgptAccountId: result.accountId ?? account.chatgptAccountId,
      planType: nextPlanType,
      supportedModelIds: planChanged ? null : account.supportedModelIds,
      unsupportedModelIds: planChanged ? [] : account.unsupportedModelIds,
      email: result.email ?? account.email,
      lastRefresh: new Date().toISOString(),
      status: "active",
      deactivationReason: null,
    }, settings.autoDisableFreePlan);
    await store.upsertAccount(updated);
    logger?.info("token_refresh.succeeded", {
      accountId: account.id,
      planType: updated.planType,
      emailPresent: updated.email !== null,
      chatgptAccountIdPresent: updated.chatgptAccountId !== null,
    });
    return updated;
  } catch (error) {
    if (error instanceof RefreshError && error.permanent) {
      if (!force) {
        const preserved: Account = {
          ...account,
          lastRefresh: new Date().toISOString(),
        };
        await store.upsertAccount(preserved);
        logger?.warn("token_refresh.permanent_background_failure", {
          accountId: account.id,
          code: error.code,
          message: error.message,
          preservedStatus: account.status,
        });
        return preserved;
      }
      const updated: Account = {
        ...account,
        status: "deactivated",
        deactivationReason: error.message,
      };
      await store.upsertAccount(updated);
      logger?.warn("token_refresh.permanent_failure", {
        accountId: account.id,
        code: error.code,
        message: error.message,
      });
    }
    logger?.error("token_refresh.failed", {
      accountId: account.id,
      ...errorContext(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// 7-2. Stored account read
async function readStoredAccount(account: Account, store: Store): Promise<Account | null> {
  return await store.getAccount(account.id);
}

// 8. Account create ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function createAccount(
  input: {
    id?: string;
    email?: string | null;
    accessToken: string;
    refreshToken: string;
    idToken: string;
    chatgptAccountId?: string | null;
    planType?: string | null;
  },
  key: Buffer,
): Account {
  const identity = extractAccountIdentity({
    accessToken: input.accessToken,
    idToken: input.idToken,
  });
  return {
    id: input.id ?? randomUUID(),
    email: input.email ?? identity.email,
    accessTokenEncrypted: encryptToken(input.accessToken, key),
    refreshTokenEncrypted: encryptToken(input.refreshToken, key),
    idTokenEncrypted: encryptToken(input.idToken, key),
    chatgptAccountId: input.chatgptAccountId ?? identity.chatgptAccountId,
    planType: input.planType ?? identity.planType,
    supportedModelIds: null,
    unsupportedModelIds: [],
    status: "active",
    deactivationReason: null,
    usedPercent: null,
    secondaryUsedPercent: null,
    resetAt: null,
    cooldownUntil: null,
    lastRefresh: new Date().toISOString(),
    lastSelectedAt: null,
    errorCount: 0,
    lastErrorAt: null,
  };
}

// 9. Error extract ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// 9-1. Error code
function extractErrorCode(payload: Record<string, unknown>): string | null {
  const error = payload.error;
  if (typeof error === "object" && error !== null && "code" in error) {
    return stringValue((error as Record<string, unknown>).code);
  }
  return stringValue(payload.error_code) ?? stringValue(payload.code);
}

// 9-2. Error message
function extractErrorMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;
  if (typeof error === "object" && error !== null) {
    return stringValue((error as Record<string, unknown>).message);
  }
  return stringValue(payload.error_description) ?? stringValue(payload.message);
}

// 9-3. String value
function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

// 9-4. Permanent refresh code
function isPermanentRefreshCode(code: string): boolean {
  return ["refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated", "account_deactivated"].includes(code);
}
