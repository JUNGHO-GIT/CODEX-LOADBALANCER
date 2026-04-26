import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, it} from "node:test";
import {decryptToken} from "../src/assets/scripts/crypto.ts";
import {createStore} from "../src/repositories/store.ts";
import {createAccount} from "../src/services/auth.ts";
import {importCodexAuthDirectory} from "../src/services/codex-auth.ts";

describe("codex auth import", () => {
  it("imports copied Codex auth files with stable account ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-auth-import-"));
    try {
      const authDir = join(root, "auth");
      await mkdir(authDir);
      await writeFile(
        join(authDir, "alpha.json"),
        `${JSON.stringify({
          auth_mode: "chatgpt",
          tokens: {
            id_token: "id-token",
            access_token: "access-token",
            refresh_token: "refresh-token",
            account_id: "account-id",
          },
          last_refresh: "2026-04-24T00:00:00.000Z",
        })}\n`,
        "utf8",
      );
      const key = Buffer.alloc(32, 1);
      const store = createStore(join(root, "store.json"));
      const imported = await importCodexAuthDirectory(authDir, store, key, false);
      const accounts = await store.listAccounts();
      const secondImported = await importCodexAuthDirectory(authDir, store, key, false);
      const secondAccounts = await store.listAccounts();

      assert.equal(imported, 1);
      assert.equal(accounts[0]?.id, "codex-auth-alpha");
      assert.equal(accounts[0]?.chatgptAccountId, "account-id");
      assert.equal(decryptToken(accounts[0].accessTokenEncrypted, key), "access-token");
      assert.equal(secondImported, 1);
      assert.equal(secondAccounts.length, 1);
    }
    finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it("preserves newer stored accounts when auth import payloads are older", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-auth-import-"));
    try {
      const authDir = join(root, "auth");
      await mkdir(authDir);
      await writeFile(
        join(authDir, "alpha.json"),
        `${JSON.stringify({
          auth_mode: "chatgpt",
          tokens: {
            id_token: "id-token-old",
            access_token: "access-token-old",
            refresh_token: "refresh-token-old",
            account_id: "account-id-old",
          },
          last_refresh: "2026-04-24T00:00:00.000Z",
        })}\n`,
        "utf8",
      );
      const key = Buffer.alloc(32, 1);
      const store = createStore(join(root, "store.json"));
      await store.upsertAccount({
        ...createAccount({
          id: "codex-auth-alpha",
          email: "alpha@example.com",
          accessToken: "access-token-new",
          refreshToken: "refresh-token-new",
          idToken: "id-token-new",
          chatgptAccountId: "account-id-new",
          planType: "plus",
        }, key),
        supportedModelIds: ["gpt-5.4"],
        lastRefresh: "2026-04-26T00:00:00.000Z",
      });

      await importCodexAuthDirectory(authDir, store, key, false);
      const account = (await store.listAccounts())[0];

      assert.equal(account?.id, "codex-auth-alpha");
      assert.equal(account?.chatgptAccountId, "account-id-new");
      assert.deepEqual(account?.supportedModelIds, ["gpt-5.4"]);
      assert.equal(decryptToken(account.accessTokenEncrypted, key), "access-token-new");
    }
    finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it("reactivates equal-timestamp imports when the stored record was only background-deactivated", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-auth-import-"));
    try {
      const authDir = join(root, "auth");
      await mkdir(authDir);
      await writeFile(
        join(authDir, "alpha.json"),
        `${JSON.stringify({
          auth_mode: "chatgpt",
          tokens: {
            id_token: "id-token",
            access_token: "access-token",
            refresh_token: "refresh-token",
            account_id: "account-id",
          },
          last_refresh: "2026-04-24T00:00:00.000Z",
        })}\n`,
        "utf8",
      );
      const key = Buffer.alloc(32, 1);
      const store = createStore(join(root, "store.json"));
      await store.upsertAccount({
        ...createAccount({
          id: "codex-auth-alpha",
          email: "alpha@example.com",
          accessToken: "stale-access-token",
          refreshToken: "stale-refresh-token",
          idToken: "stale-id-token",
          chatgptAccountId: "stale-account-id",
          planType: "plus",
        }, key),
        status: "deactivated",
        deactivationReason: "Refresh token already used",
        lastRefresh: "2026-04-24T00:00:00.000Z",
      });

      await importCodexAuthDirectory(authDir, store, key, false);
      const account = (await store.listAccounts())[0];

      assert.equal(account?.status, "active");
      assert.equal(account?.deactivationReason, null);
      assert.equal(account?.chatgptAccountId, "account-id");
      assert.equal(decryptToken(account.accessTokenEncrypted, key), "access-token");
    }
    finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
