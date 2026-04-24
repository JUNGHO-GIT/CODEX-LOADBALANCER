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
	| { kind: "exhausted"; lastRateLimit: RateLimitInfo | null };

type RateLimitInfo = {
	status: number;
	headers: Headers;
	body: Buffer;
	retryAfterSeconds: number;
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
	}

	if (lastRateLimit !== null) {
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
async function raceAccounts(
	accounts: Account[],
	req: IncomingMessage,
	body: Buffer,
	ctx: ProxyContext,
): Promise<RaceOutcome> {
	const controllers = accounts.map(() => new AbortController());
	let settled = 0;
	let done = false;
	let lastRateLimit: RateLimitInfo | null = null;

	return await new Promise<RaceOutcome>((resolve) => {
		accounts.forEach((account, index) => {
			const controller = controllers[index];
			const signal = controller?.signal ?? new AbortController().signal;
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
					if (!done && settled === accounts.length) {
						done = true;
						resolve({ kind: "exhausted", lastRateLimit });
					}
				});
		});
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
	if (retryAfterSeconds === 0) {
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
			if (typeof seconds === "number" && seconds > 0) {
				retryAfterSeconds = Math.floor(seconds);
			} else {
				const resetAt =
					codexResetsAt ?? primary?.reset_at ?? secondary?.reset_at;
				if (typeof resetAt === "number") {
					retryAfterSeconds = Math.max(
						0,
						Math.floor(resetAt - Date.now() / 1000),
					);
				}
			}
		} catch {
			// body is not structured JSON with rate_limit info
		}
	}
	if (retryAfterSeconds === 0) {
		retryAfterSeconds = 3600;
	}
	return {
		status: response.status,
		headers: response.headers,
		body,
		retryAfterSeconds,
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
