import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Account, StoreMeta } from "../src/assets/type/domain/common.ts";
import { buildRuntimeSummary as bldRtSmmr } from "../src/services/runtime-summary.ts";

// 1. Account factory ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function account(
  id: string,
  overrides: Partial<Account> = {},
): Account {
  return {
    id,
    email: null,
    accessTokenEncrypted: "access",
    refreshTokenEncrypted: "refresh",
    idTokenEncrypted: "id",
    chatgptAccountId: null,
    planType: "plus",
    supportedModelIds: ["gpt-5.5", "gpt-5.4"],
    unsupportedModelIds: [],
    status: "active",
    deactivationReason: null,
    usedPercent: 10,
    secondaryUsedPercent: 20,
    resetAt: null,
    cooldownUntil: null,
    lastRefresh: "2026-04-01T00:00:00.000Z",
    lastSelectedAt: null,
    errorCount: 0,
    lastErrorAt: null,
    ...overrides,
  };
}

describe("runtime summary", () => {
  it("excludes free-plan accounts from balancer-visible active/model counts", () => {
    const meta: StoreMeta = {
      globalCooldownUntil: null,
      globalCooldownReason: null,
    };
    const summary = bldRtSmmr(
      [
        account("paid-plus", { planType: "plus" }),
        account("free-active", { planType: "free" }),
      ],
      {
        proxyRequestBudgetSeconds: 600,
        proxyMaxBodyBytes: 10_485_760,
        parallelConcurrency: 2,
        parallelStaggerMs: 150,
        globalCooldownEnabled: true,
        usagePollIntervalSeconds: 900,
        usagePollConcurrency: 2,
        usagePollJitterMs: 5_000,
        autoDisableFreePlan: false,
      },
      meta,
    );

    assert.equal(summary.counts.totalAccounts, 2);
    assert.equal(summary.counts.activeAccounts, 1);
    assert.equal(summary.models.preferredReadyAccounts, 1);
    assert.equal(summary.models.fallbackReadyAccounts, 1);
  });
});
