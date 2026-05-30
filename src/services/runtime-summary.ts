import type { Settings } from "../assets/scripts/config.ts";
import type { Account, RuntimeSummary as RtSmmr, StoreMeta } from "../assets/type/domain/common.ts";
import {
  FPDR,
  isBalancerExcludedAccount as isBaExAc,
} from "./account-policy.ts";
import {
  FHCM,
  getModelSupportState as gtMdlSupSt,
  PHCM,
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
): RtSmmr {
  const cooldown = cooldownSummary(settings.globalCooldownEnabled, meta);
  const atOffFrAccts = accounts.filter((account) => account.deactivationReason === FPDR).length;
  const balVisAccts = accounts.filter((account) => !isBaExAc(account));
  const lrndAccts = balVisAccts.filter(isCapabilityLearned).length;
  const unknCapAccts = balVisAccts.filter((account) => !isCapabilityLearned(account)).length;
  const prefRdyAccts = balVisAccts.filter((account) => gtMdlSupSt(account, PHCM) === "supported").length;
  const fbRdyAccts = balVisAccts.filter((account) => gtMdlSupSt(account, FHCM) === "supported").length;
  const fbOnlyAccts = balVisAccts.filter((account) => {
    const prefSt = gtMdlSupSt(account, PHCM);
    const fbSt = gtMdlSupSt(account, FHCM);
    return prefSt !== "supported" && fbSt === "supported";
  }).length;
  const blcPrAc = balVisAccts.filter((account) => gtMdlSupSt(account, PHCM) === "unsupported").length;
  const blckFbAccts = balVisAccts.filter((account) => gtMdlSupSt(account, FHCM) === "unsupported").length;
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
      preferredHighCapabilityModel: PHCM,
      fallbackHighCapabilityModel: FHCM,
    },
    cooldown,
    counts: {
      totalAccounts: accounts.length,
      activeAccounts: balVisAccts.filter((account) => account.status === "active").length,
      autoDisabledFreeAccounts: atOffFrAccts,
      learnedAccounts: lrndAccts,
      unknownCapabilityAccounts: unknCapAccts,
    },
    models: {
      preferredReadyAccounts: prefRdyAccts,
      fallbackReadyAccounts: fbRdyAccts,
      fallbackOnlyAccounts: fbOnlyAccts,
      blockedPreferredAccounts: blcPrAc,
      blockedFallbackAccounts: blckFbAccts,
    },
  };
}

// 1-1. Cooldown summary
function cooldownSummary(glblCldwOn: boolean, meta: StoreMeta): RtSmmr["cooldown"] {
  const nowSeconds = Date.now() / 1000;
  const active = glblCldwOn && meta.globalCooldownUntil !== null && meta.globalCooldownUntil > nowSeconds;
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
