import type { Settings } from "../assets/scripts/config.ts";
import type { Account, RuntimeSummary, StoreMeta } from "../assets/type/domain/common.ts";
import { FREE_PLAN_DEACTIVATION_REASON } from "./account-policy.ts";
import {
  FALLBACK_HIGH_CAPABILITY_MODEL,
  getModelSupportState,
  PREFERRED_HIGH_CAPABILITY_MODEL,
} from "./balancer.ts";

// 1. Runtime summary build ――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildRuntimeSummary(
  accounts: Account[],
  settings: Pick<
    Settings,
    | "proxyRequestBudgetSeconds"
    | "proxyMaxBodyBytes"
    | "parallelConcurrency"
    | "parallelStaggerMs"
    | "globalCooldownEnabled"
    | "usagePollIntervalSeconds"
    | "usagePollConcurrency"
    | "usagePollJitterMs"
    | "autoDisableFreePlan"
  >,
  meta: StoreMeta,
): RuntimeSummary {
  const cooldown = cooldownSummary(settings.globalCooldownEnabled, meta);
  const autoDisabledFreeAccounts = accounts.filter((account) => account.deactivationReason === FREE_PLAN_DEACTIVATION_REASON).length;
  const learnedAccounts = accounts.filter(isCapabilityLearned).length;
  const unknownCapabilityAccounts = accounts.filter((account) => !isCapabilityLearned(account)).length;
  const preferredReadyAccounts = accounts.filter((account) => getModelSupportState(account, PREFERRED_HIGH_CAPABILITY_MODEL) === "supported").length;
  const fallbackReadyAccounts = accounts.filter((account) => getModelSupportState(account, FALLBACK_HIGH_CAPABILITY_MODEL) === "supported").length;
  const fallbackOnlyAccounts = accounts.filter((account) => {
    const preferredState = getModelSupportState(account, PREFERRED_HIGH_CAPABILITY_MODEL);
    const fallbackState = getModelSupportState(account, FALLBACK_HIGH_CAPABILITY_MODEL);
    return preferredState !== "supported" && fallbackState === "supported";
  }).length;
  const blockedPreferredAccounts = accounts.filter((account) => getModelSupportState(account, PREFERRED_HIGH_CAPABILITY_MODEL) === "unsupported").length;
  const blockedFallbackAccounts = accounts.filter((account) => getModelSupportState(account, FALLBACK_HIGH_CAPABILITY_MODEL) === "unsupported").length;
  return {
    settings: {
      proxyRequestBudgetSeconds: settings.proxyRequestBudgetSeconds,
      proxyMaxBodyBytes: settings.proxyMaxBodyBytes,
      parallelConcurrency: settings.parallelConcurrency,
      parallelStaggerMs: settings.parallelStaggerMs,
      globalCooldownEnabled: settings.globalCooldownEnabled,
      usagePollIntervalSeconds: settings.usagePollIntervalSeconds,
      usagePollConcurrency: settings.usagePollConcurrency,
      usagePollJitterMs: settings.usagePollJitterMs,
      autoDisableFreePlan: settings.autoDisableFreePlan,
      preferredHighCapabilityModel: PREFERRED_HIGH_CAPABILITY_MODEL,
      fallbackHighCapabilityModel: FALLBACK_HIGH_CAPABILITY_MODEL,
    },
    cooldown,
    counts: {
      totalAccounts: accounts.length,
      activeAccounts: accounts.filter((account) => account.status === "active").length,
      autoDisabledFreeAccounts,
      learnedAccounts,
      unknownCapabilityAccounts,
    },
    models: {
      preferredReadyAccounts,
      fallbackReadyAccounts,
      fallbackOnlyAccounts,
      blockedPreferredAccounts,
      blockedFallbackAccounts,
    },
  };
}

// 1-1. Cooldown summary
function cooldownSummary(globalCooldownEnabled: boolean, meta: StoreMeta): RuntimeSummary["cooldown"] {
  const nowSeconds = Date.now() / 1000;
  const active = globalCooldownEnabled && meta.globalCooldownUntil !== null && meta.globalCooldownUntil > nowSeconds;
  return {
    active,
    retryAfterSeconds: active ? Math.max(1, Math.floor((meta.globalCooldownUntil ?? nowSeconds) - nowSeconds)) : null,
    until: meta.globalCooldownUntil,
    reason: meta.globalCooldownReason,
  };
}

// 1-2. Capability learned
function isCapabilityLearned(account: Account): boolean {
  return account.supportedModelIds !== null || account.unsupportedModelIds.length > 0;
}
