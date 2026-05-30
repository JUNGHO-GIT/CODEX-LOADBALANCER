import assert from "node:assert/strict";
import {describe, it} from "node:test";
import type {Account} from "../src/assets/type/domain/common.ts";
import {
  detectSharedResetEpoch as dtcShRsEp,
  FHCM,
  PHCM,
  rankAccounts,
  recordTransientError as recTransErr,
  selectAccount as slctAcct,
} from "../src/services/balancer.ts";

// 1. Account factory ――――――――――――――――――――――――――――――――――――――――――――――――――――――
function account(id: string, usedPercent: number, lstSelAt: number | null=null): Account {
  return {
    id,
    email: null,
    accessTokenEncrypted: "x",
    refreshTokenEncrypted: "x",
    idTokenEncrypted: "x",
    chatgptAccountId: null,
    planType: null,
    supportedModelIds: null,
    unsupportedModelIds: [],
    status: "active",
    deactivationReason: null,
    usedPercent,
    secondaryUsedPercent: null,
    resetAt: null,
    cooldownUntil: null,
    lastRefresh: new Date().toISOString(),
    lastSelectedAt: lstSelAt,
    errorCount: 0,
    lastErrorAt: null,
  };
}
describe("balancer", () => {
  it("selects the lowest usage active account", () => {
    const result = slctAcct([account("a", 50), account("b", 10)]);
    assert.equal(result.account?.id, "b");
  });

  it("skips cooled down accounts", () => {
    const blocked = recTransErr(account("a", 1), 100);
    const result = slctAcct([blocked, account("b", 90)], 101);
    assert.equal(result.account?.id, "b");
  });

  it("ranks fallback candidates by cooldown, usage, and rotation", () => {
    const cooled = recTransErr(account("a", 1), 100);
    const ranked = rankAccounts([cooled, account("b", 20, 10), account("c", 20, 5), account("d", 10)], 101);

    assert.deepEqual(
      ranked.map((item) => item.id),
      ["d", "c", "b", "a"],
    );
  });

  it("excludes cooled accounts when excludeCooled option is set", () => {
    const cooled = recTransErr(account("a", 1), 100);
    const ranked = rankAccounts([cooled, account("b", 90)], 101, {
      excludeCooled: true,
    });
    assert.deepEqual(
      ranked.map((item) => item.id),
      ["b"],
    );
  });

  it("keeps rate-limited accounts as last-resort candidates", () => {
    const limited = {
      ...account("a", 10),
      status: "rate_limited" as const,
      cooldownUntil: 9999,
    };
    const ranked = rankAccounts([limited], 101);

    assert.deepEqual(
      ranked.map((item) => item.id),
      ["a"],
    );
  });

  it("excludes free-plan accounts from ranked balancer candidates", () => {
    const free = {
      ...account("a", 1),
      planType: "free",
    };
    const paid = {
      ...account("b", 90),
      planType: "plus",
    };
    const ranked = rankAccounts([free, paid], 101);

    assert.deepEqual(
      ranked.map((item) => item.id),
      ["b"],
    );
  });

  it("prefers gpt-5.5 ready accounts ahead of fallback-only accounts", () => {
    const prefRdy = {
      ...account("a", 20),
      supportedModelIds: [PHCM, FHCM],
    };
    const fallbackOnly = {
      ...account("b", 5),
      supportedModelIds: [FHCM],
    };
    const unknown = account("c", 10);
    const ranked = rankAccounts([fallbackOnly, unknown, prefRdy], 101, {
      preferredModel: PHCM,
      fallbackModel: FHCM,
    });

    assert.deepEqual(
      ranked.map((item) => item.id),
      ["a", "c", "b"],
    );
  });
});

describe("detectSharedResetEpoch", () => {
  it("returns null when fewer than two epochs are given", () => {
    assert.equal(dtcShRsEp([1_777_057_806]), null);
    assert.equal(dtcShRsEp([]), null);
  });

  it("returns the shared epoch when all values agree within tolerance", () => {
    assert.equal(dtcShRsEp([1_777_057_806, 1_777_057_806, 1_777_057_806]), 1_777_057_806);
    assert.equal(dtcShRsEp([1_777_057_806, 1_777_057_807], 2), 1_777_057_807);
  });

  it("returns null when epochs diverge beyond tolerance", () => {
    assert.equal(dtcShRsEp([1_777_057_806, 1_777_061_406]), null);
  });
});
