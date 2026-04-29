import type { Account, AccountStatus } from "../assets/type/domain/common.ts";
import { isBalancerExcludedAccount } from "./account-policy.ts";

export const PREFERRED_HIGH_CAPABILITY_MODEL = "gpt-5.5";
export const FALLBACK_HIGH_CAPABILITY_MODEL = "gpt-5.4";

export type SelectionResult = {
  account: Account | null;
  message: string | null;
};

export type ModelSupportState = "supported" | "unsupported" | "unknown";

export type RankOptions = {
  excludeCooled?: boolean;
  requestedModel?: string | null;
  preferredModel?: string | null;
  fallbackModel?: string | null;
};

type RankedAccount = {
  account: Account;
  cooldownUntil: number;
  isCooling: boolean;
  modelPriority: number;
  usage: number;
  errorCount: number;
  lastSelectedAt: number;
};

// 1. Account select ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function selectAccount(accounts: Account[], now: number = Date.now() / 1000): SelectionResult {
  const ranked = rankAccounts(accounts, now, {
    preferredModel: PREFERRED_HIGH_CAPABILITY_MODEL,
    fallbackModel: FALLBACK_HIGH_CAPABILITY_MODEL,
  });
  if (ranked.length === 0) {
    return { account: null, message: "No active accounts available" };
  }
  const selected = ranked[0] ?? null;
  return {
    account: selected,
    message: selected === null ? "No active accounts available" : null,
  };
}

// 1-1. Account rank
export function rankAccounts(accounts: Account[], now: number = Date.now() / 1000, options: RankOptions = {}): Account[] {
  const base = accounts
    .filter(isAvailable)
    .filter((account) => !isBalancerExcludedAccount(account))
    .map((account) => createRankedAccount(account, now, options))
    .toSorted(compareRankedAccount)
    .map((entry) => entry.account);
  if (options.excludeCooled !== true) {
    return base;
  }
  const fresh = base.filter((account) => (account.cooldownUntil ?? 0) <= now);
  return fresh;
}

// 1-2. Shared reset epoch detect ―――――――――――――――――――――――――――――――――――――――――
// OpenAI가 여러 ChatGPT 계정을 device/IP 기준으로 묶어 throttle할 때, 반환되는
// resets_at이 모든 계정에서 ms 단위로 동일해지는 패턴을 감지한다.
// 허용 오차를 두어 epoch가 근사하면 같은 윈도로 취급한다.
export function detectSharedResetEpoch(epochs: number[], toleranceSeconds = 1): number | null {
  const finite = epochs.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (finite.length < 2) {
    return null;
  }
  const sorted = [...finite].toSorted((a, b) => a - b);
  const first = sorted[0] ?? 0;
  const last = sorted[sorted.length - 1] ?? 0;
  if (last - first > toleranceSeconds) {
    return null;
  }
  return Math.floor(last);
}

// 2. Error record ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function recordTransientError(account: Account, now: number = Date.now() / 1000): Account {
  const errorCount = account.errorCount + 1;
  return {
    ...account,
    errorCount,
    lastErrorAt: now,
    cooldownUntil: now + Math.min(300, 30 * 2 ** Math.max(0, errorCount - 1)),
  };
}

// 3. Success record ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function recordSuccess(account: Account, now: number = Date.now() / 1000): Account {
  return {
    ...account,
    status: "active",
    errorCount: 0,
    lastErrorAt: null,
    cooldownUntil: null,
    lastSelectedAt: now,
  };
}

// 3-1. Rate-limit record ―――――――――――――――――――――――――――――――――――――――――――――――――――
export function markRateLimited(account: Account, retryAfterSeconds: number, now: number = Date.now() / 1000, status: AccountStatus = "rate_limited"): Account {
  const cooldown = now + Math.max(60, Math.floor(retryAfterSeconds));
  return {
    ...account,
    status,
    cooldownUntil: cooldown,
    resetAt: cooldown,
    lastErrorAt: now,
  };
}

// 3-2. Supported models record ―――――――――――――――――――――――――――――――――――――――――――――――――
export function recordSupportedModels(account: Account, modelIds: string[]): Account {
  const supported = [...new Set(modelIds)];
  const supportedSet = new Set(supported);
  const unsupported = account.unsupportedModelIds.filter((model) => !supportedSet.has(model));
  return {
    ...account,
    supportedModelIds: supported,
    unsupportedModelIds: unsupported,
  };
}

// 3-3. Unsupported model record
export function recordModelUnsupported(account: Account, model: string): Account {
  const unsupported = account.unsupportedModelIds.includes(model) ? account.unsupportedModelIds : [...account.unsupportedModelIds, model];
  const supported = account.supportedModelIds?.filter((item) => item !== model) ?? null;
  return {
    ...account,
    supportedModelIds: supported,
    unsupportedModelIds: unsupported,
  };
}

// 4. Availability ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// Manually-paused or permanently-inactive accounts are excluded. Cooldown
// demotes priority via compareAccount so callers can still attempt a limited
// account when nothing else is available — the cooldown may be endpoint-specific
// upstream and still worth a last resort attempt.
function isAvailable(account: Account): boolean {
  return account.status !== "deactivated" && account.status !== "paused";
}

// 5. Ranked account create ―――――――――――――――――――――――――――――――――――――――――――――――――――――
function createRankedAccount(account: Account, now: number, options: RankOptions): RankedAccount {
  const cooldownUntil = (account.cooldownUntil ?? 0) > now ? (account.cooldownUntil ?? 0) : 0;
  return {
    account,
    cooldownUntil,
    isCooling: cooldownUntil > 0,
    modelPriority: getModelPriority(account, options),
    usage: account.secondaryUsedPercent ?? account.usedPercent ?? 0,
    errorCount: account.errorCount,
    lastSelectedAt: account.lastSelectedAt ?? 0,
  };
}

// 5-1. Sort key compare ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function compareRankedAccount(left: RankedAccount, right: RankedAccount): number {
  if (left.isCooling !== right.isCooling) {
    return left.isCooling ? 1 : -1;
  }
  if (left.cooldownUntil !== right.cooldownUntil) {
    return left.cooldownUntil - right.cooldownUntil;
  }
  if (left.modelPriority !== right.modelPriority) {
    return left.modelPriority - right.modelPriority;
  }
  if (left.usage !== right.usage) {
    return left.usage - right.usage;
  }
  if (left.errorCount !== right.errorCount) {
    return left.errorCount - right.errorCount;
  }
  return left.lastSelectedAt - right.lastSelectedAt;
}

// 5-2. Model support state ―――――――――――――――――――――――――――――――――――――――――――――――――――――
export function getModelSupportState(account: Account, model: string | null): ModelSupportState {
  if (model === null) {
    return "unknown";
  }
  if (account.unsupportedModelIds.includes(model)) {
    return "unsupported";
  }
  if (account.supportedModelIds === null) {
    return "unknown";
  }
  return account.supportedModelIds.includes(model) ? "supported" : "unsupported";
}

// 5-3. Known unsupported model
export function isKnownUnsupportedModel(account: Account, model: string): boolean {
  return getModelSupportState(account, model) === "unsupported";
}

// 5-4. Model account filter
export function filterAccountsForModel(accounts: Account[], model: string | null): Account[] {
  if (model === null) {
    return accounts;
  }
  return accounts.filter((account) => getModelSupportState(account, model) !== "unsupported");
}

// 5-5. Model priority
function getModelPriority(account: Account, options: RankOptions): number {
  const preferredModel = options.preferredModel ?? PREFERRED_HIGH_CAPABILITY_MODEL;
  const fallbackModel = options.fallbackModel ?? FALLBACK_HIGH_CAPABILITY_MODEL;
  const requestedModel = options.requestedModel ?? null;
  if (requestedModel !== null) {
    return getRequestedModelPriority(account, requestedModel, preferredModel, fallbackModel);
  }
  return getImplicitModelPriority(account, preferredModel, fallbackModel);
}

// 5-6. Requested model priority
function getRequestedModelPriority(account: Account, requestedModel: string, preferredModel: string, fallbackModel: string): number {
  const requestedState = getModelSupportState(account, requestedModel);
  if (requestedState === "supported") {
    return 0;
  }
  if (requestedState === "unknown") {
    return 1;
  }
  if (requestedModel === preferredModel) {
    const fallbackState = getModelSupportState(account, fallbackModel);
    if (fallbackState === "supported") {
      return 2;
    }
    if (fallbackState === "unknown") {
      return 3;
    }
  }
  return 4;
}

// 5-7. Implicit model priority
function getImplicitModelPriority(account: Account, preferredModel: string, fallbackModel: string): number {
  const preferredState = getModelSupportState(account, preferredModel);
  const fallbackState = getModelSupportState(account, fallbackModel);
  if (preferredState === "supported") {
    return 0;
  }
  if (preferredState === "unknown") {
    return fallbackState === "supported" ? 1 : 2;
  }
  if (fallbackState === "supported") {
    return 3;
  }
  if (fallbackState === "unknown") {
    return 4;
  }
  return 5;
}
