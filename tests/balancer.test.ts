import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Account } from "../src/assets/type/domain/common.ts";
import {
	rankAccounts,
	recordTransientError,
	selectAccount,
} from "../src/services/balancer.ts";

// 1. Account factory ――――――――――――――――――――――――――――――――――――――――――――――――――――――
function account(
	id: string,
	usedPercent: number,
	lastSelectedAt: number | null = null,
): Account {
	return {
		id,
		email: null,
		accessTokenEncrypted: "x",
		refreshTokenEncrypted: "x",
		idTokenEncrypted: "x",
		chatgptAccountId: null,
		planType: null,
		status: "active",
		deactivationReason: null,
		usedPercent,
		secondaryUsedPercent: null,
		resetAt: null,
		cooldownUntil: null,
		lastRefresh: new Date().toISOString(),
		lastSelectedAt,
		errorCount: 0,
		lastErrorAt: null,
	};
}

describe("balancer", () => {
	it("selects the lowest usage active account", () => {
		const result = selectAccount([account("a", 50), account("b", 10)]);
		assert.equal(result.account?.id, "b");
	});

	it("skips cooled down accounts", () => {
		const blocked = recordTransientError(account("a", 1), 100);
		const result = selectAccount([blocked, account("b", 90)], 101);
		assert.equal(result.account?.id, "b");
	});

	it("ranks fallback candidates by cooldown, usage, and rotation", () => {
		const cooled = recordTransientError(account("a", 1), 100);
		const ranked = rankAccounts(
			[cooled, account("b", 20, 10), account("c", 20, 5), account("d", 10)],
			101,
		);

		assert.deepEqual(
			ranked.map((item) => item.id),
			["d", "c", "b", "a"],
		);
	});
});
