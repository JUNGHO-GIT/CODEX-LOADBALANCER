import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Settings } from "../src/assets/scripts/config.ts";
import { createLogger } from "../src/assets/scripts/logger.ts";
import { createStore } from "../src/repositories/store.ts";
import { createLoadBalancerServer } from "../src/routers/server.ts";
import { createAccount } from "../src/services/auth.ts";

const servers: Server[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("proxy", () => {
	it("sends upstream before refreshing stale account tokens", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			let authCalls = 0;
			let upstreamAuthorization = "";
			const upstream = createServer((req, res) => {
				upstreamAuthorization = req.headers.authorization ?? "";
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			});
			const auth = createServer((_req, res) => {
				authCalls += 1;
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_refresh" }));
			});
			const upstreamPort = await listen(upstream);
			const authPort = await listen(auth);
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			const account = {
				...createAccount(
					{
						id: "account-a",
						accessToken: "access-token",
						refreshToken: "refresh-token",
						idToken: "id-token",
					},
					key,
				),
				lastRefresh: "2026-01-01T00:00:00.000Z",
			};
			await store.upsertAccount(account);
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const response = await fetch(
				`http://127.0.0.1:${port}/backend-api/codex/responses`,
				{
					method: "POST",
					headers: { connection: "close" },
					body: JSON.stringify({ input: "hello" }),
				},
			);

			assert.equal(response.status, 200);
			assert.equal(authCalls, 0);
			assert.equal(upstreamAuthorization, "Bearer access-token");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("races remaining accounts after the primary account is rate limited", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			let slowCalled = false;
			let fastCalled = false;
			const upstream = createServer((req, res) => {
				const authorization = req.headers.authorization ?? "";
				if (authorization === "Bearer primary-token") {
					res.writeHead(429, { "content-type": "application/json" });
					res.end(
						JSON.stringify({
							error: {
								type: "usage_limit_reached",
								resets_in_seconds: 60,
							},
						}),
					);
					return;
				}
				if (authorization === "Bearer slow-token") {
					slowCalled = true;
					setTimeout(() => {
						if (!res.writableEnded) {
							res.writeHead(200, { "content-type": "application/json" });
							res.end(JSON.stringify({ account: "slow" }));
						}
					}, 300);
					return;
				}
				fastCalled = true;
				setTimeout(() => {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ account: "fast" }));
				}, 50);
			});
			const auth = createServer((_req, res) => {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_refresh" }));
			});
			const upstreamPort = await listen(upstream);
			const authPort = await listen(auth);
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			await store.upsertAccount(testAccount("account-a", "primary-token", key));
			await store.upsertAccount(testAccount("account-b", "slow-token", key));
			await store.upsertAccount(testAccount("account-c", "fast-token", key));
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const startedAt = Date.now();
			const response = await fetch(
				`http://127.0.0.1:${port}/backend-api/codex/responses`,
				{
					method: "POST",
					headers: { connection: "close" },
					body: JSON.stringify({ input: "hello" }),
				},
			);
			const body = await response.json();

			assert.equal(response.status, 200);
			assert.deepEqual(body, { account: "fast" });
			assert.equal(slowCalled, true);
			assert.equal(fastCalled, true);
			assert.ok(Date.now() - startedAt < 200);
			await delay(350);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("records every account when parallel attempts are rate limited", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			const upstream = createServer((_req, res) => {
				res.writeHead(429, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						error: {
							type: "usage_limit_reached",
							resets_in_seconds: 60,
						},
					}),
				);
			});
			const auth = createServer((_req, res) => {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_refresh" }));
			});
			const upstreamPort = await listen(upstream);
			const authPort = await listen(auth);
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			await store.upsertAccount(testAccount("account-a", "a-token", key));
			await store.upsertAccount(testAccount("account-b", "b-token", key));
			await store.upsertAccount(testAccount("account-c", "c-token", key));
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const response = await fetch(
				`http://127.0.0.1:${port}/backend-api/codex/responses`,
				{
					method: "POST",
					headers: { connection: "close" },
					body: JSON.stringify({ input: "hello" }),
				},
			);
			const accounts = await store.listAccounts();

			assert.equal(response.status, 429);
			assert.equal(
				accounts.every((account) => account.cooldownUntil !== null),
				true,
			);
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
		if (
			!(error instanceof Error && error.message === "Server is not running.")
		) {
			return Promise.reject(error);
		}
	}
	return Promise.resolve();
}

// 2-1. Test delay
function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

// 3. Settings create ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function settings(
	root: string,
	upstreamPort: number,
	authPort: number,
): Settings {
	return {
		host: "127.0.0.1",
		port: 0,
		homeDir: root,
		storePath: join(root, "store.json"),
		encryptionKeyFile: join(root, "encryption.key"),
		upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
		authBaseUrl: `http://127.0.0.1:${authPort}`,
		oauthClientId: "client",
		oauthScope: "openid",
		tokenRefreshIntervalDays: 1,
		tokenRefreshTimeoutSeconds: 1,
		proxyRequestBudgetSeconds: 600,
		apiKeyAuthEnabled: false,
		codexAuthDir: null,
		logLevel: "silent",
	};
}

// 4. Test account create ―――――――――――――――――――――――――――――――――――――――――――――――――――
function testAccount(id: string, accessToken: string, key: Buffer) {
	return createAccount(
		{
			id,
			accessToken,
			refreshToken: `${accessToken}-refresh`,
			idToken: `${accessToken}-id`,
		},
		key,
	);
}
