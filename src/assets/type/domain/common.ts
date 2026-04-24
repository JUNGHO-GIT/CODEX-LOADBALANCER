export type AccountStatus =
	| "active"
	| "paused"
	| "rate_limited"
	| "quota_exceeded"
	| "deactivated";

export type Account = {
	id: string;
	email: string | null;
	accessTokenEncrypted: string;
	refreshTokenEncrypted: string;
	idTokenEncrypted: string;
	chatgptAccountId: string | null;
	planType: string | null;
	status: AccountStatus;
	deactivationReason: string | null;
	usedPercent: number | null;
	secondaryUsedPercent: number | null;
	resetAt: number | null;
	cooldownUntil: number | null;
	lastRefresh: string;
	lastSelectedAt: number | null;
	errorCount: number;
	lastErrorAt: number | null;
};

export type ApiKey = {
	id: string;
	name: string;
	tokenHash: string;
	enabled: boolean;
	expiresAt: string | null;
	assignedAccountIds: string[];
};

export type StoreMeta = {
	globalCooldownUntil: number | null;
	globalCooldownReason: string | null;
};

export type StoreData = {
	accounts: Account[];
	apiKeys: ApiKey[];
	meta: StoreMeta;
};

export type TokenRefreshResult = {
	accessToken: string;
	refreshToken: string;
	idToken: string;
	accountId: string | null;
	planType: string | null;
	email: string | null;
};

export type UsagePayload = {
	plan_type?: string;
	rate_limit?: {
		primary_window?: UsageWindow | null;
		secondary_window?: UsageWindow | null;
	} | null;
};

export type UsageWindow = {
	used_percent?: number | null;
	reset_at?: number | null;
	reset_after_seconds?: number | null;
	limit_window_seconds?: number | null;
};

export type ProxyErrorPayload = {
	error: {
		code: string;
		message: string;
		type: string;
	};
};
