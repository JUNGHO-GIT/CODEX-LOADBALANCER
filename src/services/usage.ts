import type { Settings } from "../assets/scripts/config.ts";
import { decryptToken } from "../assets/scripts/crypto.ts";
import { errorContext, type Logger } from "../assets/scripts/logger.ts";
import type { Account, UsagePayload } from "../assets/type/domain/common.ts";
import type { Store } from "../repositories/store.ts";

// 1. Usage fetch error ―――――――――――――――――――――――――――――――――――――――――――――――――――――
export class UsageFetchError extends Error {
	statusCode: number;
	code: string | null;

	// 1-1. Error create
	constructor(statusCode: number, message: string, code: string | null) {
		super(message);
		this.statusCode = statusCode;
		this.code = code;
	}
}

// 2. Usage fetch ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function fetchUsage(
	accessToken: string,
	accountId: string | null,
	settings: Settings,
): Promise<UsagePayload> {
	const headers: Record<string, string> = {
		authorization: `Bearer ${accessToken}`,
		accept: "application/json",
	};
	if (accountId !== null) {
		headers["chatgpt-account-id"] = accountId;
	}
	const response = await fetch(
		`${settings.upstreamBaseUrl.replace(/\/$/, "")}/wham/usage`,
		{ headers },
	);
	const payload = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	if (!response.ok) {
		throw new UsageFetchError(
			response.status,
			extractMessage(payload) ?? `Usage fetch failed (${response.status})`,
			extractCode(payload),
		);
	}
	return payload as UsagePayload;
}

// 3. Usage apply ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function refreshUsage(
	account: Account,
	store: Store,
	accessToken: string,
	settings: Settings,
): Promise<Account> {
	const payload = await fetchUsage(
		accessToken,
		account.chatgptAccountId,
		settings,
	);
	const primary = payload.rate_limit?.primary_window;
	const secondary = payload.rate_limit?.secondary_window;
	const updated: Account = {
		...account,
		planType: payload.plan_type ?? account.planType,
		usedPercent:
			typeof primary?.used_percent === "number"
				? primary.used_percent
				: account.usedPercent,
		secondaryUsedPercent:
			typeof secondary?.used_percent === "number"
				? secondary.used_percent
				: account.secondaryUsedPercent,
		resetAt:
			typeof secondary?.reset_at === "number"
				? secondary.reset_at
				: account.resetAt,
	};
	await store.upsertAccount(updated);
	return updated;
}

// 3-1. Usage polling ―――――――――――――――――――――――――――――――――――――――――――――――――――――
// 부팅 후 주기적으로 active 계정의 사용량 창(primary/secondary)을 갱신해
// balancer가 정확한 usedPercent/resetAt을 기반으로 정렬할 수 있게 한다.
// 실패는 warn 로그만 남기고 다음 tick으로 넘어간다.
export type UsagePollingHandle = {
	stop(): void;
};

export function startUsagePolling(
	store: Store,
	settings: Settings,
	encryptionKey: Buffer,
	logger: Logger,
): UsagePollingHandle {
	const intervalMs = Math.max(60, settings.usagePollIntervalSeconds) * 1000;
	let running = false;
	let stopped = false;

	const tick = async (): Promise<void> => {
		if (running || stopped) {
			return;
		}
		running = true;
		try {
			const accounts = await store.listAccounts();
			const active = accounts.filter((account) => account.status === "active");
			for (const account of active) {
				if (stopped) {
					break;
				}
				try {
					const accessToken = decryptToken(
						account.accessTokenEncrypted,
						encryptionKey,
					);
					await refreshUsage(account, store, accessToken, settings);
					logger.debug("usage_poll.updated", { accountId: account.id });
				} catch (error) {
					logger.warn("usage_poll.failed", {
						accountId: account.id,
						...errorContext(error),
					});
				}
			}
		} finally {
			running = false;
		}
	};

	const timer = setInterval(() => {
		void tick();
	}, intervalMs);
	if (typeof (timer as { unref?: () => void }).unref === "function") {
		(timer as { unref: () => void }).unref();
	}
	// 첫 tick을 즉시 시작하지 않고, 서버 부팅 직후 몰림을 피해 10초 후 실행
	const kickoff = setTimeout(() => {
		void tick();
	}, 10_000);
	if (typeof (kickoff as { unref?: () => void }).unref === "function") {
		(kickoff as { unref: () => void }).unref();
	}

	return {
		stop: () => {
			stopped = true;
			clearInterval(timer);
			clearTimeout(kickoff);
		},
	};
}

// 4. Error extract ――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// 4-1. Error code
function extractCode(payload: Record<string, unknown>): string | null {
	const error = payload.error;
	if (typeof error === "object" && error !== null && "code" in error) {
		const code = (error as Record<string, unknown>).code;
		return typeof code === "string" ? code : null;
	}
	return null;
}

// 4-2. Error message
function extractMessage(payload: Record<string, unknown>): string | null {
	const error = payload.error;
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as Record<string, unknown>).message;
		return typeof message === "string" ? message : null;
	}
	return typeof payload.message === "string" ? payload.message : null;
}
