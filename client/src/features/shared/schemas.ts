import { z } from "zod";

export const AccountStatusSchema = z.enum([
  "active",
  "paused",
  "rate_limited",
  "quota_exceeded",
  "deactivated",
]);

export const AccountSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  accessTokenEncrypted: z.string().optional().default(""),
  refreshTokenEncrypted: z.string().optional().default(""),
  idTokenEncrypted: z.string().optional().default(""),
  chatgptAccountId: z.string().nullable(),
  planType: z.string().nullable(),
  supportedModelIds: z.array(z.string()).nullable(),
  unsupportedModelIds: z.array(z.string()),
  status: AccountStatusSchema,
  deactivationReason: z.string().nullable(),
  usedPercent: z.number().nullable(),
  secondaryUsedPercent: z.number().nullable(),
  resetAt: z.number().nullable(),
  cooldownUntil: z.number().nullable(),
  lastRefresh: z.string(),
  lastSelectedAt: z.number().nullable(),
  errorCount: z.number(),
  lastErrorAt: z.number().nullable(),
});

export const RuntimeSummarySchema = z.object({
  settings: z.object({
    proxyRequestBudgetSeconds: z.number(),
    proxyMaxBodyBytes: z.number(),
    parallelConcurrency: z.number(),
    parallelStaggerMs: z.number(),
    globalCooldownEnabled: z.boolean(),
    usagePollIntervalSeconds: z.number(),
    usagePollConcurrency: z.number(),
    usagePollJitterMs: z.number(),
    autoDisableFreePlan: z.boolean(),
    preferredHighCapabilityModel: z.string(),
    fallbackHighCapabilityModel: z.string(),
  }),
  cooldown: z.object({
    active: z.boolean(),
    retryAfterSeconds: z.number().nullable(),
    until: z.number().nullable(),
    reason: z.string().nullable(),
  }),
  counts: z.object({
    totalAccounts: z.number(),
    activeAccounts: z.number(),
    autoDisabledFreeAccounts: z.number(),
    learnedAccounts: z.number(),
    unknownCapabilityAccounts: z.number(),
  }),
  models: z.object({
    preferredReadyAccounts: z.number(),
    fallbackReadyAccounts: z.number(),
    fallbackOnlyAccounts: z.number(),
    blockedPreferredAccounts: z.number(),
    blockedFallbackAccounts: z.number(),
  }),
});

export const HealthResponseSchema = z.object({
  status: z.string().optional(),
});

export const AccountsResponseSchema = z.object({
  accounts: z.array(AccountSchema).default([]),
});

export const AccountCreateResponseSchema = z.object({
  id: z.string(),
});

export type Account = z.infer<typeof AccountSchema>;
export type RuntimeSummary = z.infer<typeof RuntimeSummarySchema>;

export type LoadBalancerSnapshot = {
  health: "ok" | "down";
  accounts: Account[];
  runtimeSummary: RuntimeSummary | null;
  updatedAt: string;
};

export type SnapshotHistoryPoint = {
  sourceUpdatedAt: string;
  timestamp: number;
  accountCount: number;
  activeAccountCount: number;
  healthScore: number;
  preferredReadyAccountCount: number;
  autoDisabledFreeAccountCount: number;
};
