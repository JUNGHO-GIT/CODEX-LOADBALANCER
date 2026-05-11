import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Settings } from "../src/assets/scripts/config.ts";
import { createLogger } from "../src/assets/scripts/logger.ts";
import { createStore } from "../src/repositories/store.ts";
import { createLoadBalancerServer } from "../src/routers/server.ts";
import { FREE_PLAN_DEACTIVATION_REASON } from "../src/services/account-policy.ts";
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

	it("logs account name and remaining usage percentages on proxy success", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			const logLines: string[] = [];
			const sink = {
				debug: (line: string) => logLines.push(line),
				info: (line: string) => logLines.push(line),
				log: (line: string) => logLines.push(line),
				warn: (line: string) => logLines.push(line),
				error: (line: string) => logLines.push(line),
			};
			const upstream = createServer((_req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			});
			const auth = createServer((_req, res) => {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_refresh" }));
			});
			const upstreamPort = await listen(upstream);
			const authPort = await listen(auth);
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			await store.upsertAccount({
				...createAccount(
					{
						id: "account-a",
						email: "alpha@example.com",
						accessToken: "access-token",
						refreshToken: "refresh-token",
						idToken: "id-token",
						planType: "plus",
					},
					key,
				),
				usedPercent: 40,
				secondaryUsedPercent: 70,
			});
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort),
				encryptionKey: key,
				store,
				logger: createLogger("info", {}, sink),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const requestBody = Buffer.from((globalThis as typeof globalThis & {
				Bun: { zstdCompressSync(input: Buffer): Uint8Array };
			}).Bun.zstdCompressSync(Buffer.from(JSON.stringify({
				model: "gpt-5.5",
				reasoning: { effort: "high" },
				input: "hello",
			}), "utf8")));
			const response = await fetch(
				`http://127.0.0.1:${port}/backend-api/codex/responses`,
				{
					method: "POST",
					headers: {
						connection: "close",
						"content-encoding": "zstd",
						"content-type": "application/json",
					},
					body: requestBody,
				},
			);
			const logText = logLines.join("\n").replace(/\u001b\[[0-9;]*m/g, "");

			assert.equal(response.status, 200);
			assert.match(logText, /AccountName : alpha@example\.com/);
			assert.match(logText, /ModelName : gpt-5\.5 high/);
			assert.match(logText, /FiveHourRemainingPercent : 60%/);
			assert.match(logText, /WeeklyRemainingPercent : 30%/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("shares one token refresh across concurrent 401 retries for the same account", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			let authCalls = 0;
			let oldTokenHits = 0;
			let newTokenHits = 0;
			const upstream = createServer((req, res) => {
				const authorization = req.headers.authorization ?? "";
				if (authorization === "Bearer old-token") {
					oldTokenHits += 1;
					res.writeHead(401, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: "expired" }));
					return;
				}
				if (authorization === "Bearer new-token") {
					newTokenHits += 1;
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({
						object: "list",
						data: [
							{ id: "gpt-4.1", object: "model" },
						],
					}));
					return;
				}
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_token" }));
			});
			const auth = createServer((_req, res) => {
				authCalls += 1;
				setTimeout(() => {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(
						JSON.stringify({
							access_token: "new-token",
							refresh_token: "new-refresh-token",
							id_token: "new-id-token",
						}),
					);
				}, 50);
			});
			const upstreamPort = await listen(upstream);
			const authPort = await listen(auth);
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			await store.upsertAccount(testAccount("account-a", "old-token", key));
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const requests = [0, 1].map(() =>
				fetch(`http://127.0.0.1:${port}/backend-api/codex/models`, {
					headers: { connection: "close" },
				}),
			);
			const responses = await Promise.all(requests);

			assert.deepEqual(
				responses.map((response) => response.status),
				[200, 200],
			);
			assert.equal(authCalls, 1);
			assert.equal(oldTokenHits, 2);
			assert.equal(newTokenHits, 2);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reloads Codex auth files before OAuth refresh when an imported account gets 401", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			let authCalls = 0;
			const seenAuthorizations: string[] = [];
			const upstream = createServer((req, res) => {
				const authorization = req.headers.authorization ?? "";
				seenAuthorizations.push(authorization);
				if (authorization === "Bearer old-token") {
					res.writeHead(401, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: "expired" }));
					return;
				}
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
			const authFile = join(root, "auth.json");
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			await store.upsertAccount({
				...createAccount(
					{
						id: "codex-auth-auth",
						email: "auth@example.com",
						accessToken: "old-token",
						refreshToken: "old-refresh",
						idToken: "old-id",
						chatgptAccountId: "account-id",
						planType: "plus",
					},
					key,
				),
				lastRefresh: "2026-05-10T00:00:00.000Z",
			});
			await writeFile(
				authFile,
				JSON.stringify({
					auth_mode: "chatgpt",
					tokens: {
						id_token: "new-id",
						access_token: "new-token",
						refresh_token: "new-refresh",
						account_id: "account-id",
					},
					last_refresh: "2026-05-11T00:00:00.000Z",
				}),
				"utf8",
			);
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort, {
					codexAuthDir: authFile,
				}),
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
			assert.deepEqual(seenAuthorizations, ["Bearer old-token", "Bearer new-token"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("skips accounts that reject a requested model and remembers that incompatibility", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			let unsupportedHits = 0;
			let supportedHits = 0;
			const upstream = createServer(async (req, res) => {
				const authorization = req.headers.authorization ?? "";
				const payload = JSON.parse((await readIncoming(req)).toString("utf8")) as {
					model?: string;
				};
				if (authorization === "Bearer primary-token" && payload.model === "gpt-5.5") {
					unsupportedHits += 1;
					res.writeHead(400, { "content-type": "application/json" });
					res.end(JSON.stringify({
						detail: "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.",
					}));
					return;
				}
				if (authorization === "Bearer secondary-token") {
					supportedHits += 1;
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ account: "secondary" }));
					return;
				}
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_request" }));
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
			await store.upsertAccount(testAccount("account-b", "secondary-token", key));
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const request = () =>
				fetch(`http://127.0.0.1:${port}/backend-api/codex/responses`, {
					method: "POST",
					headers: {
						connection: "close",
						"content-type": "application/json",
					},
					body: JSON.stringify({ model: "gpt-5.5", input: "hello" }),
				});

			const first = await request();
			const second = await request();
			const firstBody = await first.json();
			const secondBody = await second.json();
			const accounts = await store.listAccounts();
			const primary = accounts.find((account) => account.id === "account-a");

			assert.equal(first.status, 200);
			assert.equal(second.status, 200);
			assert.deepEqual(firstBody, { account: "secondary" });
			assert.deepEqual(secondBody, { account: "secondary" });
			assert.equal(unsupportedHits, 1);
			assert.equal(supportedHits, 2);
			assert.deepEqual(primary?.unsupportedModelIds, ["gpt-5.5"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("falls back from gpt-5.5 to gpt-5.4 when only fallback-ready accounts remain", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			const seenModels: string[] = [];
			const upstream = createServer(async (req, res) => {
				const authorization = req.headers.authorization ?? "";
				const payload = JSON.parse((await readIncoming(req)).toString("utf8")) as {
					model?: string;
				};
				seenModels.push(payload.model ?? "missing");
				if (authorization === "Bearer fallback-token" && payload.model === "gpt-5.4") {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ account: "fallback", model: payload.model }));
					return;
				}
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_request" }));
			});
			const auth = createServer((_req, res) => {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_refresh" }));
			});
			const upstreamPort = await listen(upstream);
			const authPort = await listen(auth);
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			await store.upsertAccount({
				...testAccount("account-a", "fallback-token", key),
				supportedModelIds: ["gpt-5.4"],
			});
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const response = await fetch(`http://127.0.0.1:${port}/backend-api/codex/responses`, {
				method: "POST",
				headers: {
					connection: "close",
					"content-type": "application/json",
				},
				body: JSON.stringify({ model: "gpt-5.5", input: "hello" }),
			});
			const body = await response.json();

			assert.equal(response.status, 200);
			assert.deepEqual(body, { account: "fallback", model: "gpt-5.4" });
			assert.deepEqual(seenModels, ["gpt-5.4"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("merges model catalogs across active accounts", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			const upstream = createServer((req, res) => {
				const authorization = req.headers.authorization ?? "";
				if (req.url === "/models" && authorization === "Bearer first-token") {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({
						object: "list",
						data: [
							{ id: "gpt-4.1", object: "model" },
						],
					}));
					return;
				}
				if (req.url === "/models" && authorization === "Bearer second-token") {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({
						object: "list",
						data: [
							{ id: "gpt-5.5", object: "model" },
							{ id: "gpt-4.1", object: "model" },
						],
					}));
					return;
				}
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_request" }));
			});
			const auth = createServer((_req, res) => {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_refresh" }));
			});
			const upstreamPort = await listen(upstream);
			const authPort = await listen(auth);
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			await store.upsertAccount(testAccount("account-a", "first-token", key));
			await store.upsertAccount(testAccount("account-b", "second-token", key));
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const response = await fetch(`http://127.0.0.1:${port}/backend-api/codex/models`, {
				headers: { connection: "close" },
			});
			const body = await response.json() as {
				data?: Array<{ id?: string }>;
			};
			const modelIds = body.data?.map((item) => item.id).sort();
			const accounts = await store.listAccounts();
			const first = accounts.find((account) => account.id === "account-a");
			const second = accounts.find((account) => account.id === "account-b");

			assert.equal(response.status, 200);
			assert.deepEqual(modelIds, ["gpt-4.1", "gpt-5.5"]);
			assert.deepEqual(first?.supportedModelIds, ["gpt-4.1"]);
			assert.deepEqual(second?.supportedModelIds, ["gpt-5.5", "gpt-4.1"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("auto-disables free-plan accounts created through the api and exposes runtime summary", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			const upstream = createServer((_req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			});
			const auth = createServer((_req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			});
			const upstreamPort = await listen(upstream);
			const authPort = await listen(auth);
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort, {
					autoDisableFreePlan: true,
				}),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const createResponse = await fetch(`http://127.0.0.1:${port}/api/accounts`, {
				method: "POST",
				headers: {
					connection: "close",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					email: "free@example.com",
					accessToken: "access-token",
					refreshToken: "refresh-token",
					idToken: "id-token",
					planType: "free",
				}),
			});
			const accounts = await store.listAccounts();
			const summaryResponse = await fetch(`http://127.0.0.1:${port}/api/runtime-summary`, {
				headers: { connection: "close" },
			});
			const summary = await summaryResponse.json() as {
				settings: {
					preferredHighCapabilityModel: string;
					fallbackHighCapabilityModel: string;
				};
				counts: {
					autoDisabledFreeAccounts: number;
				};
			};

			assert.equal(createResponse.status, 201);
			assert.equal(accounts[0]?.status, "deactivated");
			assert.equal(accounts[0]?.deactivationReason, FREE_PLAN_DEACTIVATION_REASON);
			assert.equal(summaryResponse.status, 200);
			assert.equal(summary.counts.autoDisabledFreeAccounts, 1);
			assert.equal(summary.settings.preferredHighCapabilityModel, "gpt-5.5");
			assert.equal(summary.settings.fallbackHighCapabilityModel, "gpt-5.4");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects oversized proxy request bodies before upstream selection", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			let upstreamHits = 0;
			const upstream = createServer((_req, res) => {
				upstreamHits += 1;
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			});
			const auth = createServer((_req, res) => {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_refresh" }));
			});
			const upstreamPort = await listen(upstream);
			const authPort = await listen(auth);
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort, {
					proxyMaxBodyBytes: 8,
				}),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const response = await fetch(`http://127.0.0.1:${port}/backend-api/codex/responses`, {
				method: "POST",
				headers: {
					connection: "close",
					"content-type": "application/json",
				},
				body: JSON.stringify({ input: "too large" }),
			});
			const body = await response.json() as {
				error?: { code?: string };
			};

			assert.equal(response.status, 413);
			assert.equal(body.error?.code, "request_body_too_large");
			assert.equal(upstreamHits, 0);
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

	it("clears global cooldown through the runtime api", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			const upstream = createServer((_req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			});
			const auth = createServer((_req, res) => {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unexpected_refresh" }));
			});
			const upstreamPort = await listen(upstream);
			const authPort = await listen(auth);
			const key = Buffer.alloc(32, 1);
			const store = createStore(join(root, "store.json"));
			await store.setMeta({
				globalCooldownUntil: Math.floor(Date.now() / 1000) + 300,
				globalCooldownReason: "test_cooldown",
			});
			const server = createLoadBalancerServer({
				settings: settings(root, upstreamPort, authPort, {
					globalCooldownEnabled: true,
				}),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const before = await fetch(`http://127.0.0.1:${port}/api/runtime-summary`, {
				headers: { connection: "close" },
			});
			const clear = await fetch(`http://127.0.0.1:${port}/api/global-cooldown/clear`, {
				method: "POST",
				headers: { connection: "close" },
			});
			const beforeBody = await before.json() as {
				cooldown?: { active?: boolean };
			};
			const clearBody = await clear.json() as {
				cooldown?: { active?: boolean };
			};
			const meta = await store.getMeta();

			assert.equal(before.status, 200);
			assert.equal(beforeBody.cooldown?.active, true);
			assert.equal(clear.status, 200);
			assert.equal(clearBody.cooldown?.active, false);
			assert.deepEqual(meta, {
				globalCooldownUntil: null,
				globalCooldownReason: null,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("short-circuits when global cooldown is active and shared reset is detected", async () => {
		const root = await mkdtemp(join(tmpdir(), "codex-lb-proxy-"));
		try {
			const sharedResetAt = Math.floor(Date.now() / 1000) + 11_749;
			let upstreamHits = 0;
			const upstream = createServer((_req, res) => {
				upstreamHits += 1;
				res.writeHead(429, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						error: {
							type: "usage_limit_reached",
							resets_at: sharedResetAt,
							resets_in_seconds: 11_749,
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
				settings: settings(root, upstreamPort, authPort, {
					globalCooldownEnabled: true,
				}),
				encryptionKey: key,
				store,
				logger: createLogger("silent"),
				upstreamBase: `http://127.0.0.1:${upstreamPort}`,
			});
			const port = await listen(server);

			const first = await fetch(
				`http://127.0.0.1:${port}/backend-api/codex/responses`,
				{
					method: "POST",
					headers: { connection: "close" },
					body: JSON.stringify({ input: "hello" }),
				},
			);
			assert.equal(first.status, 429);
			assert.ok(upstreamHits >= 2);
			const hitsAfterFirst = upstreamHits;

			const meta = await store.getMeta();
			assert.equal(meta.globalCooldownUntil, sharedResetAt);
			assert.equal(meta.globalCooldownReason, "shared_reset_epoch_detected");

			const second = await fetch(
				`http://127.0.0.1:${port}/backend-api/codex/responses`,
				{
					method: "POST",
					headers: { connection: "close" },
					body: JSON.stringify({ input: "hello" }),
				},
			);
			const body = (await second.json()) as {
				error?: { code?: string };
			};
			assert.equal(second.status, 429);
			assert.equal(body.error?.code, "usage_limit_reached");
			assert.equal(upstreamHits, hitsAfterFirst);
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

// 2-2. Incoming read
async function readIncoming(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		chunks.push(buf);
		total += buf.length;
	}
	return Buffer.concat(chunks, total);
}

// 3. Settings create ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function settings(
	root: string,
	upstreamPort: number,
	authPort: number,
	overrides: Partial<Settings> = {},
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
		proxyMaxBodyBytes: 10_485_760,
		apiKeyAuthEnabled: false,
		codexAuthDir: null,
		logLevel: "silent",
		parallelConcurrency: 4,
		parallelStaggerMs: 0,
		globalCooldownEnabled: false,
		usagePollIntervalSeconds: 900,
		usagePollConcurrency: 2,
		usagePollJitterMs: 5_000,
		autoDisableFreePlan: false,
		...overrides,
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
