import { createHash } from "node:crypto";
import type {
	IncomingHttpHeaders,
	IncomingMessage,
	ServerResponse,
} from "node:http";
import type { Settings } from "../assets/scripts/config.ts";
import { decryptToken } from "../assets/scripts/crypto.ts";
import { errorContext, type Logger } from "../assets/scripts/logger.ts";
import type {
	Account,
	ProxyErrorPayload,
} from "../assets/type/domain/common.ts";
import type { Store } from "../repositories/store.ts";
import { ensureFreshAccount, RefreshError } from "./auth.ts";
import {
	detectSharedResetEpoch,
	markRateLimited,
	rankAccounts,
	recordSuccess,
	recordTransientError,
} from "./balancer.ts";

export type ProxyContext = {
	settings: Settings;
	store: Store;
	encryptionKey: Buffer;
	logger: Logger;
	upstreamBase: string;
};

type AttemptSuccess = {
	account: Account;
	response: Response;
	retried: boolean;
};

type RaceOutcome =
	| { kind: "winner"; winner: AttemptSuccess }
	| {
			kind: "exhausted";
			lastRateLimit: RateLimitInfo | null;
			resetEpochs: number[];
	  };

type RateLimitInfo = {
	status: number;
	headers: Headers;
	body: Buffer;
	retryAfterSeconds: number;
	resetAtEpoch: number | null;
};

// Token decryption cache: one entry per account, invalidated when the stored
// ciphertext rotates (refresh). Avoids GCM decrypt on every upstream call.
const tokenCache = new Map<string, { encrypted: string; plain: string }>();

// 1. Proxy request ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function proxyRequest(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: ProxyContext,
): Promise<void> {
	if (!(await validateApiKey(req.headers, ctx))) {
		ctx.logger.warn("proxy.auth_rejected", { reason: "invalid_api_key" });
		writeJson(
			res,
			401,
			openaiError(
				"invalid_api_key",
				"Invalid API key",
				"invalid_request_error",
			),
		);
		return;
	}

	if (ctx.settings.globalCooldownEnabled) {
		const shortCircuit = await shortCircuitGlobalCooldown(ctx);
		if (shortCircuit !== null) {
			writeJson(res, 429, shortCircuit.payload);
			ctx.logger.warn("proxy.global_cooldown_short_circuit", {
				retryAfterSeconds: shortCircuit.retryAfterSeconds,
				reason: shortCircuit.reason,
			});
			return;
		}
	}

	const accounts = await ctx.store.listAccounts();
	const candidates = rankAccounts(accounts);
	const best = candidates[0] ?? null;
	if (best === null) {
		ctx.logger.warn("proxy.account_unavailable", {
			reason: "No active accounts available",
			accountCount: accounts.length,
		});
		writeJson(
			res,
			503,
			openaiError(
				"no_accounts",
				"No active accounts available",
				"server_error",
			),
		);
		return;
	}

	const body = await readBody(req);
	let lastRateLimit: RateLimitInfo | null = null;
	let lastError: unknown = null;
	const resetEpochs: number[] = [];

	const remaining = candidates.slice(1);
	ctx.logger.info("proxy.account_selected", {
		accountId: best.id,
		usedPercent: best.usedPercent,
		candidateCount: accounts.length,
		mode: "primary",
	});
	try {
		const outcome = await attemptAccount(best, req, body, ctx);
		if (outcome.response.status === 429) {
			const info = await readRateLimit(outcome.response);
			await ctx.store.upsertAccount(
				markRateLimited(outcome.account, info.retryAfterSeconds),
			);
			lastRateLimit = info;
			if (info.resetAtEpoch !== null) {
				resetEpochs.push(info.resetAtEpoch);
			}
			ctx.logger.warn("proxy.upstream_rate_limited", {
				accountId: outcome.account.id,
				retryAfterSeconds: info.retryAfterSeconds,
				retried: outcome.retried ? true : undefined,
				remainingCandidates: remaining.length,
				mode: "primary",
				bodyPreview: info.body.toString("utf8").slice(0, 300),
			});
		} else {
			await ctx.store.upsertAccount(recordSuccess(outcome.account));
			ctx.logger.info("proxy.request_succeeded", {
				accountId: outcome.account.id,
				statusCode: outcome.response.status,
				retried: outcome.retried ? true : undefined,
				mode: "primary",
			});
			await pipeFetchResponse(outcome.response, res);
			return;
		}
	} catch (error) {
		lastError = error;
		await handleAttemptError(best, error, ctx, remaining.length, "primary");
	}

	if (remaining.length > 0) {
		const race = await raceAccounts(remaining, req, body, ctx);
		if (race.kind === "winner") {
			void ctx.store.upsertAccount(recordSuccess(race.winner.account));
			ctx.logger.info("proxy.request_succeeded", {
				accountId: race.winner.account.id,
				statusCode: race.winner.response.status,
				retried: race.winner.retried ? true : undefined,
				mode: "parallel",
			});
			await pipeFetchResponse(race.winner.response, res);
			return;
		}
		if (race.lastRateLimit !== null) {
			lastRateLimit = race.lastRateLimit;
		}
		for (const epoch of race.resetEpochs) {
			resetEpochs.push(epoch);
		}
	}

	if (lastRateLimit !== null) {
		await maybeRecordGlobalCooldown(resetEpochs, ctx);
		ctx.logger.warn("proxy.all_accounts_rate_limited", {
			retryAfterSeconds: lastRateLimit.retryAfterSeconds,
		});
		writeBufferedResponse(res, lastRateLimit);
		return;
	}

	ctx.logger.error("proxy.request_failed", { ...errorContext(lastError) });
	writeJson(
		res,
		502,
		openaiError(
			"upstream_unavailable",
			errorMessage(lastError),
			"server_error",
		),
	);
}

// 1-0. Global cooldown short-circuit ―――――――――――――――――――――――――――――――――――――
async function shortCircuitGlobalCooldown(ctx: ProxyContext): Promise<{
	payload: ProxyErrorPayload;
	retryAfterSeconds: number;
	reason: string;
} | null> {
	const meta = await ctx.store.getMeta();
	if (meta.globalCooldownUntil === null) {
		return null;
	}
	const nowSeconds = Date.now() / 1000;
	if (meta.globalCooldownUntil <= nowSeconds) {
		await ctx.store.setMeta({
			globalCooldownUntil: null,
			globalCooldownReason: null,
		});
		return null;
	}
	const retryAfterSeconds = Math.max(
		1,
		Math.floor(meta.globalCooldownUntil - nowSeconds),
	);
	return {
		payload: {
			error: {
				code: "usage_limit_reached",
				message: `Shared account quota cooldown active for ${retryAfterSeconds}s`,
				type: "rate_limit_error",
			},
		},
		retryAfterSeconds,
		reason: meta.globalCooldownReason ?? "shared_reset_epoch",
	};
}

// 1-0-1. Global cooldown record ――――――――――――――――――――――――――――――――――――――――
async function maybeRecordGlobalCooldown(
	resetEpochs: number[],
	ctx: ProxyContext,
): Promise<void> {
	if (!ctx.settings.globalCooldownEnabled) {
		return;
	}
	const shared = detectSharedResetEpoch(resetEpochs);
	if (shared === null) {
		return;
	}
	await ctx.store.setMeta({
		globalCooldownUntil: shared,
		globalCooldownReason: "shared_reset_epoch_detected",
	});
	ctx.logger.warn("proxy.global_cooldown_recorded", {
		globalCooldownUntil: shared,
		observedAccounts: resetEpochs.length,
	});
}

// 1-1. Attempt a single account (401 auto-refresh) ――――――――――――――――――――――――
async function attemptAccount(
	account: Account,
	req: IncomingMessage,
	body: Buffer,
	ctx: ProxyContext,
	signal?: AbortSignal,
): Promise<AttemptSuccess> {
	let response = await sendUpstream(req, body, account, ctx, false, signal);
	if (response.status !== 401) {
		return { account, response, retried: false };
	}
	signal?.throwIfAborted();
	ctx.logger.warn("proxy.token_refresh_retry", { accountId: account.id });
	const refreshed = await ensureFreshAccount(
		account,
		ctx.store,
		ctx.settings,
		ctx.encryptionKey,
		true,
		ctx.logger,
	);
	tokenCache.delete(refreshed.id);
	signal?.throwIfAborted();
	response = await sendUpstream(req, body, refreshed, ctx, true, signal);
	return { account: refreshed, response, retried: true };
}

// 1-2. Parallel race across accounts ――――――――――――――――――――――――――――――――――――――
// 계정 간 동시 타격으로 OpenAI의 abuse-detection(동일 IP·계정 스위칭)이
// 가속되는 현상을 완화하기 위해 동시성 N + staggered 지연으로 전환한다.
// "모든 계정 시도 보장" 계약은 유지하므로 최종적으로 모두 시도된다.
async function raceAccounts(
	accounts: Account[],
	req: IncomingMessage,
	body: Buffer,
	ctx: ProxyContext,
): Promise<RaceOutcome> {
	const controllers = accounts.map(() => new AbortController());
	const concurrencyLimit = Math.max(
		1,
		Math.min(ctx.settings.parallelConcurrency, accounts.length),
	);
	const staggerMs = Math.max(0, ctx.settings.parallelStaggerMs);
	let settled = 0;
	let launched = 0;
	let done = false;
	let lastRateLimit: RateLimitInfo | null = null;
	const resetEpochs: number[] = [];

	return await new Promise<RaceOutcome>((resolve) => {
		const launch = (index: number): void => {
			if (done || index >= accounts.length) {
				return;
			}
			const account = accounts[index];
			const controller = controllers[index];
			if (account === undefined || controller === undefined) {
				return;
			}
			const signal = controller.signal;
			ctx.logger.info("proxy.account_selected", {
				accountId: account.id,
				usedPercent: account.usedPercent,
				candidateCount: accounts.length,
				mode: "parallel",
			});
			attemptAccount(account, req, body, ctx, signal)
				.then(async (outcome) => {
					if (done) {
						await discardBody(outcome.response);
						return;
					}
					if (outcome.response.status === 429) {
						const info = await readRateLimit(outcome.response);
						lastRateLimit = info;
						if (info.resetAtEpoch !== null) {
							resetEpochs.push(info.resetAtEpoch);
						}
						await ctx.store.upsertAccount(
							markRateLimited(outcome.account, info.retryAfterSeconds),
						);
						ctx.logger.warn("proxy.upstream_rate_limited", {
							accountId: outcome.account.id,
							retryAfterSeconds: info.retryAfterSeconds,
							retried: outcome.retried ? true : undefined,
							mode: "parallel",
							bodyPreview: info.body.toString("utf8").slice(0, 300),
						});
						return;
					}
					done = true;
					for (let i = 0; i < controllers.length; i += 1) {
						if (i !== index) {
							controllers[i]?.abort();
						}
					}
					resolve({ kind: "winner", winner: outcome });
				})
				.catch(async (error) => {
					if (signal.aborted) {
						return;
					}
					await handleAttemptError(
						account,
						error,
						ctx,
						accounts.length - settled - 1,
						"parallel",
					);
				})
				.finally(() => {
					settled += 1;
					if (done) {
						return;
					}
					if (launched < accounts.length) {
						launch(launched);
						launched += 1;
					} else if (settled === accounts.length) {
						done = true;
						resolve({ kind: "exhausted", lastRateLimit, resetEpochs });
					}
				});
		};

		const initial = Math.min(concurrencyLimit, accounts.length);
		for (let i = 0; i < initial; i += 1) {
			if (i === 0 || staggerMs === 0) {
				launch(i);
			} else {
				setTimeout(() => {
					if (!done) {
						launch(i);
					}
				}, staggerMs * i);
			}
		}
		launched = initial;
	});
}

// 1-3. Error bookkeeping ――――――――――――――――――――――――――――――――――――――――――――――――
async function handleAttemptError(
	account: Account,
	error: unknown,
	ctx: ProxyContext,
	remainingCandidates: number,
	mode: "primary" | "parallel",
): Promise<void> {
	if (error instanceof RefreshError && error.permanent) {
		ctx.logger.warn("proxy.permanent_refresh_failure", {
			accountId: account.id,
			code: error.code,
			message: error.message,
			remainingCandidates,
			mode,
		});
		return;
	}
	await ctx.store.upsertAccount(recordTransientError(account));
	ctx.logger.error("proxy.account_attempt_failed", {
		accountId: account.id,
		remainingCandidates,
		mode,
		...errorContext(error),
	});
}

// 1-4. Discard unused response body ―――――――――――――――――――――――――――――――――――――――
async function discardBody(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// body may already be closed due to abort
	}
}

// 1-5. Rate-limit read ――――――――――――――――――――――――――――――――――――――――――――――――――――
async function readRateLimit(response: Response): Promise<RateLimitInfo> {
	const body = Buffer.from(await response.arrayBuffer());
	let retryAfterSeconds = 0;
	let resetAtEpoch: number | null = null;
	const retryHeader = response.headers.get("retry-after");
	if (retryHeader !== null) {
		const seconds = Number.parseInt(retryHeader, 10);
		if (Number.isFinite(seconds) && seconds > 0) {
			retryAfterSeconds = seconds;
		} else {
			const epoch = Date.parse(retryHeader);
			if (Number.isFinite(epoch)) {
				retryAfterSeconds = Math.max(
					0,
					Math.floor((epoch - Date.now()) / 1000),
				);
			}
		}
	}
	try {
		const parsed = JSON.parse(body.toString("utf8")) as {
			error?: {
				resets_in_seconds?: number;
				resets_at?: number;
			} | null;
			rate_limit?: {
				primary_window?: {
					reset_after_seconds?: number;
					reset_at?: number;
				} | null;
				secondary_window?: {
					reset_after_seconds?: number;
					reset_at?: number;
				} | null;
			} | null;
		};
		const codexResets = parsed.error?.resets_in_seconds;
		const codexResetsAt = parsed.error?.resets_at;
		const primary = parsed.rate_limit?.primary_window;
		const secondary = parsed.rate_limit?.secondary_window;
		const seconds =
			codexResets ??
			primary?.reset_after_seconds ??
			secondary?.reset_after_seconds;
		if (retryAfterSeconds === 0 && typeof seconds === "number" && seconds > 0) {
			retryAfterSeconds = Math.floor(seconds);
		}
		const resetAt = codexResetsAt ?? primary?.reset_at ?? secondary?.reset_at;
		if (typeof resetAt === "number" && Number.isFinite(resetAt)) {
			resetAtEpoch = Math.floor(resetAt);
			if (retryAfterSeconds === 0) {
				retryAfterSeconds = Math.max(
					0,
					Math.floor(resetAt - Date.now() / 1000),
				);
			}
		}
	} catch {
		// body is not structured JSON with rate_limit info
	}
	if (retryAfterSeconds === 0) {
		retryAfterSeconds = 3600;
	}
	if (resetAtEpoch === null) {
		resetAtEpoch = Math.floor(Date.now() / 1000) + retryAfterSeconds;
	}
	return {
		status: response.status,
		headers: response.headers,
		body,
		retryAfterSeconds,
		resetAtEpoch,
	};
}

// 1-6. Buffered response write ――――――――――――――――――――――――――――――――――――――――――――
const STRIPPED_RESPONSE_HEADERS = new Set([
	"content-encoding",
	"content-length",
	"transfer-encoding",
]);

function writeBufferedResponse(res: ServerResponse, info: RateLimitInfo): void {
	res.statusCode = info.status;
	info.headers.forEach((value, key) => {
		if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
			res.setHeader(key, value);
		}
	});
	res.end(info.body);
}

// 2. Upstream send ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function sendUpstream(
	req: IncomingMessage,
	body: Buffer,
	account: Account,
	ctx: ProxyContext,
	forceRefreshed: boolean,
	signal?: AbortSignal,
): Promise<Response> {
	const accessToken = getAccessToken(account, ctx.encryptionKey);
	const headers = upstreamHeaders(
		req.headers,
		accessToken,
		account.chatgptAccountId,
	);
	const url = upstreamUrl(req.url ?? "/", ctx.upstreamBase);
	const method = req.method ?? "GET";
	const requestBody =
		body.length > 0 && method !== "GET" && method !== "HEAD" ? body : undefined;
	const response = await fetch(url, {
		method,
		headers,
		body: requestBody as BodyInit | undefined,
		signal,
	});
	if (response.status === 401 && forceRefreshed) {
		throw new Error("Upstream rejected refreshed token");
	}
	return response;
}

// 2-1. Token cache ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function getAccessToken(account: Account, key: Buffer): string {
	const cached = tokenCache.get(account.id);
	if (cached && cached.encrypted === account.accessTokenEncrypted) {
		return cached.plain;
	}
	const plain = decryptToken(account.accessTokenEncrypted, key);
	tokenCache.set(account.id, {
		encrypted: account.accessTokenEncrypted,
		plain,
	});
	return plain;
}

// 3. API key check ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function validateApiKey(
	headers: IncomingHttpHeaders,
	ctx: ProxyContext,
): Promise<boolean> {
	if (!ctx.settings.apiKeyAuthEnabled) {
		return true;
	}
	const raw = headers.authorization;
	const authorization = Array.isArray(raw) ? raw[0] : raw;
	const token = authorization?.toLowerCase().startsWith("bearer ")
		? authorization.slice(7).trim()
		: "";
	if (!token) {
		return false;
	}
	const hash = createHash("sha256").update(token).digest("hex");
	const keys = await ctx.store.listApiKeys();
	const now = Date.now();
	return keys.some(
		(key) =>
			key.enabled &&
			key.tokenHash === hash &&
			(key.expiresAt === null || Date.parse(key.expiresAt) > now),
	);
}

// 4. Headers ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
const STRIPPED_REQUEST_HEADERS = new Set([
	"host",
	"authorization",
	"content-length",
]);

function upstreamHeaders(
	headers: IncomingHttpHeaders,
	accessToken: string,
	accountId: string | null,
): Headers {
	const next = new Headers();
	for (const name in headers) {
		const value = headers[name];
		if (
			value === undefined ||
			STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())
		) {
			continue;
		}
		next.set(name, Array.isArray(value) ? value.join(", ") : `${value}`);
	}
	next.set("authorization", `Bearer ${accessToken}`);
	if (accountId !== null) {
		next.set("chatgpt-account-id", accountId);
	}
	return next;
}

// 5. URL map ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function upstreamUrl(path: string, base: string): string {
	if (path.startsWith("/v1/")) {
		return `${base}${path}`;
	}
	if (path.startsWith("/backend-api/codex/")) {
		return `${base}${path.slice("/backend-api/codex".length)}`;
	}
	return `${base}${path}`;
}

// 6. Response pipe ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function pipeFetchResponse(
	response: Response,
	res: ServerResponse,
): Promise<void> {
	res.statusCode = response.status;
	response.headers.forEach((value, key) => {
		if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
			res.setHeader(key, value);
		}
	});
	if (response.body === null) {
		res.end();
		return;
	}
	const reader = response.body.getReader();
	while (true) {
		const item = await reader.read();
		if (item.done) {
			break;
		}
		await writeResponseChunk(res, item.value);
	}
	res.end();
}

// 6-1. Response chunk write
function writeResponseChunk(
	res: ServerResponse,
	chunk: Uint8Array,
): Promise<void> {
	const written = res.write(Buffer.from(chunk));
	if (written) {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			res.off("close", onClose);
			res.off("drain", onDrain);
			res.off("error", onError);
		};
		const onClose = () => {
			cleanup();
			reject(new Error("Client connection closed during response streaming"));
		};
		const onDrain = () => {
			cleanup();
			resolve();
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		res.once("close", onClose);
		res.once("drain", onDrain);
		res.once("error", onError);
	});
}

// 7. Body read ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		chunks.push(buf);
		total += buf.length;
	}
	if (chunks.length === 0) {
		return Buffer.alloc(0);
	}
	if (chunks.length === 1) {
		return chunks[0] ?? Buffer.alloc(0);
	}
	return Buffer.concat(chunks, total);
}

// 8. Error JSON ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// 8-1. OpenAI error
export function openaiError(
	code: string,
	message: string,
	type: string,
): ProxyErrorPayload {
	return { error: { code, message, type } };
}

// 8-2. JSON write
export function writeJson(
	res: ServerResponse,
	status: number,
	payload: unknown,
): void {
	const body = JSON.stringify(payload);
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.setHeader("content-length", Buffer.byteLength(body));
	res.end(body);
}

// 8-3. Error message
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Request to upstream failed";
}
