import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { describe, it } from "node:test";
import type { Settings } from "../src/assets/scripts/config.ts";
import type { Account } from "../src/assets/type/domain/common.ts";
import { FREE_PLAN_DEACTIVATION_REASON } from "../src/services/account-policy.ts";
import { buildUsagePollingPlan, fetchUsage } from "../src/services/usage.ts";

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
  it("fetches usage from the Codex usage endpoint", async () => {
    let requestedUrl = "";
    const server = createServer((req, res) => {
      requestedUrl = req.url ?? "";
      assert.equal(req.headers.authorization, "Bearer access-token");
      assert.equal(req.headers["chatgpt-account-id"], "account-id");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        plan_type: "plus",
        rate_limit: {
          primary_window: {
            used_percent: 10,
            reset_at: 1_800_000_000,
          },
        },
      }));
    });
    const port = await listen(server);
    try {
      const usage = await fetchUsage(
        "access-token",
        "account-id",
        settings("http://127.0.0.1:" + port + "/backend-api/codex"),
      );

      assert.equal(requestedUrl, "/backend-api/codex/usage");
      assert.equal(usage.plan_type, "plus");
      assert.equal(usage.rate_limit?.primary_window?.used_percent, 10);
    }
    finally {
      await closeServer(server);
    }
  });

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

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolve(address.port);
        return;
      }
      reject(new Error("Server did not bind to a TCP port"));
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

function settings(upstreamBaseUrl: string): Settings {
  return {
    host: "127.0.0.1",
    port: 0,
    homeDir: "",
    storePath: "",
    encryptionKeyFile: "",
    upstreamBaseUrl,
    authBaseUrl: "http://127.0.0.1",
    oauthClientId: "client",
    oauthScope: "openid",
    tokenRefreshIntervalDays: 1,
    tokenRefreshTimeoutSeconds: 1,
    proxyRequestBudgetSeconds: 600,
    proxyMaxBodyBytes: 10_485_760,
    apiKeyAuthEnabled: false,
    codexAuthDir: null,
    logLevel: "silent",
    parallelConcurrency: 2,
    parallelStaggerMs: 0,
    globalCooldownEnabled: false,
    usagePollIntervalSeconds: 900,
    usagePollConcurrency: 2,
    usagePollJitterMs: 0,
    autoDisableFreePlan: false,
  };
}
