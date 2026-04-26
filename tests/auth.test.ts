import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Settings } from "../src/assets/scripts/config.ts";
import { createStore } from "../src/repositories/store.ts";
import { createAccount, ensureFreshAccount, RefreshError } from "../src/services/auth.ts";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("auth refresh", () => {
  it("keeps the current account active when background refresh tokens are permanently blocked", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-auth-refresh-"));
    try {
      const auth = createServer((_req, res) => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({
          error: {
            code: "refresh_token_reused",
            message: "Refresh token already used",
          },
        }));
      });
      const authPort = await listen(auth);
      const key = Buffer.alloc(32, 1);
      const store = createStore(join(root, "store.json"));
      const account = {
        ...createAccount({
          id: "account-a",
          accessToken: "access-token",
          refreshToken: "refresh-token",
          idToken: "id-token",
        }, key),
        lastRefresh: "2026-04-01T00:00:00.000Z",
      };
      await store.upsertAccount(account);

      const refreshed = await ensureFreshAccount(account, store, settings(root, authPort), key, false);
      const stored = await store.getAccount(account.id);

      assert.equal(refreshed.status, "active");
      assert.equal(stored?.status, "active");
      assert.equal(stored?.deactivationReason, null);
      assert.notEqual(stored?.lastRefresh, account.lastRefresh);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deactivates the account when a forced refresh is permanently rejected", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-auth-refresh-"));
    try {
      const auth = createServer((_req, res) => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({
          error: {
            code: "refresh_token_reused",
            message: "Refresh token already used",
          },
        }));
      });
      const authPort = await listen(auth);
      const key = Buffer.alloc(32, 1);
      const store = createStore(join(root, "store.json"));
      const account = {
        ...createAccount({
          id: "account-a",
          accessToken: "access-token",
          refreshToken: "refresh-token",
          idToken: "id-token",
        }, key),
        lastRefresh: "2026-04-01T00:00:00.000Z",
      };
      await store.upsertAccount(account);

      await assert.rejects(
        ensureFreshAccount(account, store, settings(root, authPort), key, true),
        (error: unknown) => error instanceof RefreshError && error.code === "refresh_token_reused",
      );
      const stored = await store.getAccount(account.id);

      assert.equal(stored?.status, "deactivated");
      assert.equal(stored?.deactivationReason, "Refresh token already used");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// 1. Server listen ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolve(address.port);
      } else {
        reject(new Error("Server did not bind to a TCP port"));
      }
    });
  });
}

// 2. Server close ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function closeServer(server: Server): Promise<void> {
  try {
    server.closeAllConnections();
    server.closeIdleConnections();
    server.close();
  } catch (error) {
    if (!(error instanceof Error && error.message === "Server is not running.")) {
      return Promise.reject(error);
    }
  }
  return Promise.resolve();
}

// 3. Settings create ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function settings(root: string, authPort: number): Settings {
  return {
    host: "127.0.0.1",
    port: 0,
    homeDir: root,
    storePath: join(root, "store.json"),
    encryptionKeyFile: join(root, "encryption.key"),
    upstreamBaseUrl: "https://chatgpt.com/backend-api/codex",
    authBaseUrl: `http://127.0.0.1:${authPort}`,
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
    parallelStaggerMs: 150,
    globalCooldownEnabled: true,
    usagePollIntervalSeconds: 900,
    usagePollConcurrency: 2,
    usagePollJitterMs: 5_000,
    autoDisableFreePlan: true,
  };
}
