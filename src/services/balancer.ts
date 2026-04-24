import type { Account } from "../assets/type/domain/common.ts";

export type SelectionResult = {
	account: Account | null;
	message: string | null;
};

export type RankOptions = {
	excludeCooled?: boolean;
};

// 1. Account select ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function selectAccount(
	accounts: Account[],
	now: number = Date.now() / 1000,
): SelectionResult {
	const ranked = rankAccounts(accounts, now);
	if (ranked.length === 0) {
		return { account: null, message: "No active accounts available" };
	}
	const selected = ranked[0] ?? null;
	return {
		account: selected,
		message: selected === null ? "No active accounts available" : null,
	};
}

// 1-1. Account rank
export function rankAccounts(
	accounts: Account[],
	now: number = Date.now() / 1000,
	options: RankOptions = {},
): Account[] {
	const base = accounts
		.filter(isAvailable)
		.toSorted((a, b) => compareAccount(a, b, now));
	if (options.excludeCooled !== true) {
		return base;
	}
	const fresh = base.filter((account) => (account.cooldownUntil ?? 0) <= now);
	return fresh;
}

// 1-2. Shared reset epoch detect ―――――――――――――――――――――――――――――――――――――――――
// OpenAI가 여러 ChatGPT 계정을 device/IP 기준으로 묶어 throttle할 때, 반환되는
// resets_at이 모든 계정에서 ms 단위로 동일해지는 패턴을 감지한다.
// 허용 오차를 두어 epoch가 근사하면 같은 윈도로 취급한다.
export function detectSharedResetEpoch(
	epochs: number[],
	toleranceSeconds = 1,
): number | null {
	const finite = epochs.filter(
		(value): value is number =>
			typeof value === "number" && Number.isFinite(value) && value > 0,
	);
	if (finite.length < 2) {
		return null;
	}
	const sorted = [...finite].toSorted((a, b) => a - b);
	const first = sorted[0] ?? 0;
	const last = sorted[sorted.length - 1] ?? 0;
	if (last - first > toleranceSeconds) {
		return null;
	}
	return Math.floor(last);
}

// 2. Error record ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function recordTransientError(
	account: Account,
	now: number = Date.now() / 1000,
): Account {
	const errorCount = account.errorCount + 1;
	return {
		...account,
		errorCount,
		lastErrorAt: now,
		cooldownUntil: now + Math.min(300, 30 * 2 ** Math.max(0, errorCount - 1)),
	};
}

// 3. Success record ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function recordSuccess(
	account: Account,
	now: number = Date.now() / 1000,
): Account {
	return {
		...account,
		status: "active",
		errorCount: 0,
		lastErrorAt: null,
		cooldownUntil: null,
		lastSelectedAt: now,
	};
}

// 3-1. Rate-limit record ―――――――――――――――――――――――――――――――――――――――――――――――――――
export function markRateLimited(
	account: Account,
	retryAfterSeconds: number,
	now: number = Date.now() / 1000,
): Account {
	const cooldown = now + Math.max(60, Math.floor(retryAfterSeconds));
	return {
		...account,
		cooldownUntil: cooldown,
		resetAt: cooldown,
		lastErrorAt: now,
	};
}

// 4. Availability ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// Only permanently-inactive accounts are excluded. Cooldown demotes priority
// via compareAccount so callers can still attempt a rate-limited account when
// nothing else is available — the cooldown may be endpoint-specific upstream.
function isAvailable(account: Account): boolean {
	return account.status === "active";
}

// 5. Sort key ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function compareAccount(left: Account, right: Account, now: number): number {
	const leftCool =
		(left.cooldownUntil ?? 0) > now ? (left.cooldownUntil ?? 0) : 0;
	const rightCool =
		(right.cooldownUntil ?? 0) > now ? (right.cooldownUntil ?? 0) : 0;
	if (leftCool > 0 !== rightCool > 0) {
		return leftCool > 0 ? 1 : -1;
	}
	if (leftCool !== rightCool) {
		return leftCool - rightCool;
	}
	const leftUsage = left.secondaryUsedPercent ?? left.usedPercent ?? 0;
	const rightUsage = right.secondaryUsedPercent ?? right.usedPercent ?? 0;
	if (leftUsage !== rightUsage) {
		return leftUsage - rightUsage;
	}
	return (left.lastSelectedAt ?? 0) - (right.lastSelectedAt ?? 0);
}
