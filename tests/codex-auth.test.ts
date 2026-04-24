import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { decryptToken } from "../src/assets/scripts/crypto.ts";
import { createStore } from "../src/repositories/store.ts";
import { importCodexAuthDirectory } from "../src/services/codex-auth.ts";

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
			const imported = await importCodexAuthDirectory(authDir, store, key);
			const accounts = await store.listAccounts();
			const secondImported = await importCodexAuthDirectory(
				authDir,
				store,
				key,
			);
			const secondAccounts = await store.listAccounts();

			assert.equal(imported, 1);
			assert.equal(accounts[0]?.id, "codex-auth-alpha");
			assert.equal(accounts[0]?.chatgptAccountId, "account-id");
			assert.equal(
				decryptToken(accounts[0].accessTokenEncrypted, key),
				"access-token",
			);
			assert.equal(secondImported, 1);
			assert.equal(secondAccounts.length, 1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
