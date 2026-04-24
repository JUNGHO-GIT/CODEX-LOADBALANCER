import { randomUUID } from "node:crypto";
import type { Settings } from "../assets/scripts/config.ts";
import { decryptToken, encryptToken } from "../assets/scripts/crypto.ts";
import { errorContext, type Logger } from "../assets/scripts/logger.ts";
import type {
	Account,
	TokenRefreshResult,
} from "../assets/type/domain/common.ts";
import type { Store } from "../repositories/store.ts";

// 1. Refresh error ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export class RefreshError extends Error {
	code: string;
	permanent: boolean;

	// 1-1. Error create
	constructor(code: string, message: string, permanent: boolean) {
		super(message);
		this.code = code;
		this.permanent = permanent;
	}
}

// 2. Refresh needed ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function shouldRefresh(
	account: Account,
	intervalDays: number,
	now: Date = new Date(),
): boolean {
	const last = Date.parse(account.lastRefresh);
	if (!Number.isFinite(last)) {
		return true;
	}
	return now.getTime() - last > intervalDays * 24 * 60 * 60 * 1000;
}

// 3. Access refresh ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function refreshAccessToken(
	refreshToken: string,
	settings: Settings,
	signal?: AbortSignal,
): Promise<TokenRefreshResult> {
	const response = await fetch(
		`${settings.authBaseUrl.replace(/\/$/, "")}/oauth/token`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				grant_type: "refresh_token",
				client_id: settings.oauthClientId,
				refresh_token: refreshToken,
				scope: settings.oauthScope,
			}),
			signal,
		},
	);
	const payload = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	if (!response.ok) {
		const code = extractErrorCode(payload) ?? `http_${response.status}`;
		const message =
			extractErrorMessage(payload) ??
			`Token refresh failed (${response.status})`;
		throw new RefreshError(code, message, isPermanentRefreshCode(code));
	}
	const accessToken = stringValue(payload.access_token);
	const nextRefreshToken = stringValue(payload.refresh_token);
	const idToken = stringValue(payload.id_token);
	if (!accessToken || !nextRefreshToken || !idToken) {
		throw new RefreshError(
			"invalid_response",
			"Refresh response missing tokens",
			false,
		);
	}
	return {
		accessToken,
		refreshToken: nextRefreshToken,
		idToken,
		accountId: null,
		planType: null,
		email: null,
	};
}

// 4. Account ensure ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function ensureFreshAccount(
	account: Account,
	store: Store,
	settings: Settings,
	key: Buffer,
	force = false,
	logger?: Logger,
): Promise<Account> {
	if (!force && !shouldRefresh(account, settings.tokenRefreshIntervalDays)) {
		logger?.debug("token_refresh.skipped", {
			accountId: account.id,
			lastRefresh: account.lastRefresh,
		});
		return account;
	}
	logger?.info("token_refresh.started", {
		accountId: account.id,
		force,
		lastRefresh: account.lastRefresh,
	});
	const refreshToken = decryptToken(account.refreshTokenEncrypted, key);
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		settings.tokenRefreshTimeoutSeconds * 1000,
	);
	try {
		const result = await refreshAccessToken(
			refreshToken,
			settings,
			controller.signal,
		);
		const updated: Account = {
			...account,
			accessTokenEncrypted: encryptToken(result.accessToken, key),
			refreshTokenEncrypted: encryptToken(result.refreshToken, key),
			idTokenEncrypted: encryptToken(result.idToken, key),
			chatgptAccountId: result.accountId ?? account.chatgptAccountId,
			planType: result.planType ?? account.planType,
			email: result.email ?? account.email,
			lastRefresh: new Date().toISOString(),
			status: "active",
			deactivationReason: null,
		};
		await store.upsertAccount(updated);
		logger?.info("token_refresh.succeeded", {
			accountId: account.id,
			planType: updated.planType,
			emailPresent: updated.email !== null,
			chatgptAccountIdPresent: updated.chatgptAccountId !== null,
		});
		return updated;
	} catch (error) {
		if (error instanceof RefreshError && error.permanent) {
			const updated: Account = {
				...account,
				status: "deactivated",
				deactivationReason: error.message,
			};
			await store.upsertAccount(updated);
			logger?.warn("token_refresh.permanent_failure", {
				accountId: account.id,
				code: error.code,
				message: error.message,
			});
		}
		logger?.error("token_refresh.failed", {
			accountId: account.id,
			...errorContext(error),
		});
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

// 5. Account create ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function createAccount(
	input: {
		id?: string;
		email?: string | null;
		accessToken: string;
		refreshToken: string;
		idToken: string;
		chatgptAccountId?: string | null;
		planType?: string | null;
	},
	key: Buffer,
): Account {
	return {
		id: input.id ?? randomUUID(),
		email: input.email ?? null,
		accessTokenEncrypted: encryptToken(input.accessToken, key),
		refreshTokenEncrypted: encryptToken(input.refreshToken, key),
		idTokenEncrypted: encryptToken(input.idToken, key),
		chatgptAccountId: input.chatgptAccountId ?? null,
		planType: input.planType ?? null,
		status: "active",
		deactivationReason: null,
		usedPercent: null,
		secondaryUsedPercent: null,
		resetAt: null,
		cooldownUntil: null,
		lastRefresh: new Date().toISOString(),
		lastSelectedAt: null,
		errorCount: 0,
		lastErrorAt: null,
	};
}

// 6. Error extract ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// 6-1. Error code
function extractErrorCode(payload: Record<string, unknown>): string | null {
	const error = payload.error;
	if (typeof error === "object" && error !== null && "code" in error) {
		return stringValue((error as Record<string, unknown>).code);
	}
	return stringValue(payload.error_code) ?? stringValue(payload.code);
}

// 6-2. Error message
function extractErrorMessage(payload: Record<string, unknown>): string | null {
	const error = payload.error;
	if (typeof error === "object" && error !== null) {
		return stringValue((error as Record<string, unknown>).message);
	}
	return stringValue(payload.error_description) ?? stringValue(payload.message);
}

// 6-3. String value
function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

// 6-4. Permanent refresh code
function isPermanentRefreshCode(code: string): boolean {
	return [
		"refresh_token_expired",
		"refresh_token_reused",
		"refresh_token_invalidated",
		"account_deactivated",
	].includes(code);
}
