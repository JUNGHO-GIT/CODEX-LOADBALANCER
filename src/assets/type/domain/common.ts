export declare type AccountStatus = "active" | "paused" | "rate_limited" | "quota_exceeded" | "deactivated";

export declare type Account = {
  id: string;
  email: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  idTokenEncrypted: string;
  chatgptAccountId: string | null;
  planType: string | null;
  supportedModelIds: string[] | null;
  unsupportedModelIds: string[];
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

export declare type ApiKey = {
  id: string;
  name: string;
  tokenHash: string;
  enabled: boolean;
  expiresAt: string | null;
  assignedAccountIds: string[];
};

export declare type StoreMeta = {
  globalCooldownUntil: number | null;
  globalCooldownReason: string | null;
};

export declare type StoreData = {
  accounts: Account[];
  apiKeys: ApiKey[];
  meta: StoreMeta;
};

export declare type RuntimeSummary = {
  settings: {
    proxyRequestBudgetSeconds: number;
    proxyMaxBodyBytes: number;
    parallelConcurrency: number;
    parallelStaggerMs: number;
    globalCooldownEnabled: boolean;
    usagePollIntervalSeconds: number;
    usagePollConcurrency: number;
    usagePollJitterMs: number;
    autoDisableFreePlan: boolean;
    preferredHighCapabilityModel: string;
    fallbackHighCapabilityModel: string;
  };
  cooldown: {
    active: boolean;
    retryAfterSeconds: number | null;
    until: number | null;
    reason: string | null;
  };
  counts: {
    totalAccounts: number;
    activeAccounts: number;
    autoDisabledFreeAccounts: number;
    learnedAccounts: number;
    unknownCapabilityAccounts: number;
  };
  models: {
    preferredReadyAccounts: number;
    fallbackReadyAccounts: number;
    fallbackOnlyAccounts: number;
    blockedPreferredAccounts: number;
    blockedFallbackAccounts: number;
  };
};

export declare type TokenRefreshResult = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId: string | null;
  planType: string | null;
  email: string | null;
};

export declare type UsagePayload = {
  plan_type?: string;
  rate_limit?: {
    primary_window?: UsageWindow | null;
    secondary_window?: UsageWindow | null;
  } | null;
};

export declare type UsageWindow = {
  used_percent?: number | null;
  reset_at?: number | null;
  reset_after_seconds?: number | null;
  limit_window_seconds?: number | null;
};

export declare type ProxyErrorPayload = {
  error: {
    code: string;
    message: string;
    type: string;
  };
};
