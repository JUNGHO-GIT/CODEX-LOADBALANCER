import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Account } from "../src/assets/type/domain/common.ts";
import { FREE_PLAN_DEACTIVATION_REASON } from "../src/services/account-policy.ts";
import { buildUsagePollingPlan } from "../src/services/usage.ts";

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
    supportedModelIds: null,
    unsupportedModelIds: [],
    status: "active",
    deactivationReason: null,
    usedPercent: 20,
    secondaryUsedPercent: 10,
    resetAt: null,
    cooldownUntil: null,
    lastRefresh: "2026-04-01T00:00:00.000Z",
    lastSelectedAt: null,
    errorCount: 0,
    lastErrorAt: null,
    ...overrides,
  };
}

describe("usage polling planner", () => {
  it("splits paid usage candidates from free-plan interval refresh candidates", () => {
    const paid = account("paid-plus", {
      planType: "plus",
    });
    const free = account("free-active", {
      planType: "free",
    });
    const autoDisabledFree = account("free-disabled", {
      planType: "free",
      status: "deactivated",
      deactivationReason: FREE_PLAN_DEACTIVATION_REASON,
    });
    const pausedFree = account("free-paused", {
      planType: "free",
      status: "paused",
    });

    const plan = buildUsagePollingPlan(
      [paid, free, autoDisabledFree, pausedFree],
      { tokenRefreshIntervalDays: 1 },
      new Map(),
      Date.parse("2026-04-27T00:00:00.000Z"),
    );

    assert.deepEqual(
      plan.usageCandidates.map((item) => item.id),
      ["paid-plus"],
    );
    assert.deepEqual(
      plan.intervalRefreshCandidates.map((item) => item.id),
      ["free-active", "free-disabled"],
    );
  });

  it("respects per-account backoff windows for both polling stages", () => {
    const paid = account("paid-plus");
    const free = account("free-active", {
      planType: "free",
    });
    const now = Date.parse("2026-04-27T00:00:00.000Z");
    const states = new Map([
      ["paid-plus", { failureCount: 1, nextAttemptAt: now + 30_000, stage: "usage" as const }],
      ["free-active", { failureCount: 2, nextAttemptAt: now + 30_000, stage: "interval_refresh" as const }],
    ]);

    const plan = buildUsagePollingPlan(
      [paid, free],
      { tokenRefreshIntervalDays: 1 },
      states,
      now,
    );

    assert.deepEqual(plan.usageCandidates, []);
    assert.deepEqual(plan.intervalRefreshCandidates, []);
  });
});
