import type { Account, AccountStatus, RuntimeSummary, SnapshotHistoryPoint } from "./api";

export type UsageWindowKey = "primary" | "secondary";
export type InsightTone = "primary" | "success" | "warning" | "danger" | "neutral";
export type MetricTrendKey = "accountCount" | "healthScore" | "preferredReadyAccountCount" | "autoDisabledFreeAccountCount";

export type RingSegment = {
  label: string;
  value: number;
  color: string;
  meta: string;
};

export type InsightItem = {
  label: string;
  value: string | number;
  caption: string;
  tone: InsightTone;
};

export type MetricChartSegment = {
  label: string;
  value: number;
  color: string;
  meta: string;
};

const RING_COLORS: string[] = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

const ACTIVE_POOL_COLOR = "var(--success)";
const LIMITED_POOL_COLOR = "var(--warning)";
const INACTIVE_POOL_COLOR = "var(--danger)";
const PENDING_POOL_COLOR = "var(--muted)";

const STATUS_ORDER: AccountStatus[] = [
  "active",
  "rate_limited",
  "quota_exceeded",
  "paused",
  "deactivated",
];

const STATUS_LABELS: Record<AccountStatus, string> = {
  active: "Active",
  paused: "Paused",
  rate_limited: "Rate limited",
  quota_exceeded: "Quota exceeded",
  deactivated: "Deactivated",
};

const STATUS_TONES: Record<AccountStatus, InsightTone> = {
  active: "success",
  paused: "neutral",
  rate_limited: "warning",
  quota_exceeded: "warning",
  deactivated: "danger",
};

const PREFERRED_HIGH_CAPABILITY_MODEL = "gpt-5.5";
const FALLBACK_HIGH_CAPABILITY_MODEL = "gpt-5.4";

// 1. Percent clamp ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// 2. Positive segment build ――――――――――――――――――――――――――――――――――――――――――――――――――――――
function createPositiveSegment(label: string, value: number, color: string, meta: string): MetricChartSegment | null {
  if (value <= 0) {
    return null;
  }
  return {
    label,
    value,
    color,
    meta,
  };
}

// 3. Segment compact ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function compactSegments(segments: Array<MetricChartSegment | null>): MetricChartSegment[] {
  return segments.filter((segment): segment is MetricChartSegment => segment !== null);
}

// 4. Account label format ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatAccountLabel(account: Account): string {
  return account.email?.trim() || account.id;
}

// 5. Plan label format ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatPlanLabel(planType: string | null): string {
  return planType?.trim() || "Unknown";
}

// 6. Status label format ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatStatusLabel(status: AccountStatus): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

// 7. Remaining percent read ―――――――――――――――――――――――――――――――――――――――――――――――――――――
export function getRemainingPercent(account: Account, windowKey: UsageWindowKey): number | null {
  const usedPercent = windowKey === "primary" ? account.usedPercent : account.secondaryUsedPercent;
  if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
    return null;
  }
  return clampPercent(100 - usedPercent);
}

// 8. Average remaining build ――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function getAverageRemaining(accounts: Account[], windowKey: UsageWindowKey): number | null {
  const values = accounts
    .map((account) => getRemainingPercent(account, windowKey))
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return clampPercent(total / values.length);
}

// 9. Account pool chart segments build ―――――――――――――――――――――――――――――――――――――――――――――
export function buildAccountPoolSegments(accounts: Account[]): MetricChartSegment[] {
  const activeCount = accounts.filter((account) => account.status === "active").length;
  const limitedCount = accounts.filter((account) => account.status === "rate_limited" || account.status === "quota_exceeded").length;
  const inactiveCount = Math.max(accounts.length - activeCount - limitedCount, 0);
  return compactSegments([
    createPositiveSegment("Active", activeCount, ACTIVE_POOL_COLOR, `${activeCount} ready`),
    createPositiveSegment("Limited", limitedCount, LIMITED_POOL_COLOR, `${limitedCount} cooled`),
    createPositiveSegment("Inactive", inactiveCount, INACTIVE_POOL_COLOR, `${inactiveCount} paused`),
  ]);
}

// 10. Health chart segments build ――――――――――――――――――――――――――――――――――――――――――――――――
export function buildHealthSegments(health: "ok" | "down"): MetricChartSegment[] {
  return [
    {
      label: health === "ok" ? "Online" : "Down",
      value: 1,
      color: health === "ok" ? ACTIVE_POOL_COLOR : INACTIVE_POOL_COLOR,
      meta: health === "ok" ? "live endpoint ok" : "health endpoint down",
    },
  ];
}

// 11. Model readiness chart segments build ――――――――――――――――――――――――――――――――――――――――
export function buildModelReadinessSegments(summary: RuntimeSummary | null): MetricChartSegment[] {
  if (summary === null) {
    return [];
  }
  const preferredCount = summary.models.preferredReadyAccounts;
  const fallbackOnlyCount = summary.models.fallbackOnlyAccounts;
  const blockedCount = summary.models.blockedPreferredAccounts;
  const pendingCount = Math.max(summary.counts.totalAccounts - preferredCount - fallbackOnlyCount - blockedCount, 0);
  return compactSegments([
    createPositiveSegment("5.5", preferredCount, "var(--chart-1)", `${preferredCount} preferred`),
    createPositiveSegment("5.4", fallbackOnlyCount, "var(--chart-2)", `${fallbackOnlyCount} fallback only`),
    createPositiveSegment("Blocked", blockedCount, "var(--chart-3)", `${blockedCount} blocked`),
    createPositiveSegment("Pending", pendingCount, PENDING_POOL_COLOR, `${pendingCount} learning`),
  ]);
}

// 12. Free plan chart segments build ――――――――――――――――――――――――――――――――――――――――――――――
export function buildFreePlanSegments(summary: RuntimeSummary | null): MetricChartSegment[] {
  if (summary === null) {
    return [];
  }
  const disabledCount = summary.counts.autoDisabledFreeAccounts;
  const remainingCount = Math.max(summary.counts.totalAccounts - disabledCount, 0);
  return compactSegments([
    createPositiveSegment("Auto-disabled", disabledCount, "var(--chart-3)", `${disabledCount} free accounts`),
    createPositiveSegment("Remaining", remainingCount, "var(--chart-1)", `${remainingCount} tracked`),
  ]);
}

// 13. Metric trend points build ―――――――――――――――――――――――――――――――――――――――――――――――――
export function buildMetricTrendPoints(history: SnapshotHistoryPoint[], key: MetricTrendKey): number[] {
  const points = history
    .map((point) => point[key])
    .filter((value) => Number.isFinite(value));
  return points;
}

// 14. Usage segments build ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildUsageSegments(accounts: Account[], windowKey: UsageWindowKey): RingSegment[] {
  const rankedSegments: Omit<RingSegment, "color">[] = [];
  for (const account of accounts) {
    const remaining = getRemainingPercent(account, windowKey);
    if (remaining === null) {
      continue;
    }
    const planLabel = formatPlanLabel(account.planType);
    const meta = planLabel === "Unknown"
      ? formatStatusLabel(account.status)
      : `${formatStatusLabel(account.status)} · ${planLabel}`;
    rankedSegments.push({
      label: formatAccountLabel(account),
      value: remaining,
      meta,
    });
  }

  rankedSegments.sort((left, right) => right.value - left.value);

  const visibleSegments: Omit<RingSegment, "color">[] = rankedSegments.slice(0, 5);
  const hiddenSegments: Omit<RingSegment, "color">[] = rankedSegments.slice(5);
  const mergedSegments: Omit<RingSegment, "color">[] = hiddenSegments.length === 0
    ? visibleSegments
    : [
        ...visibleSegments,
        {
          label: "Other",
          value: hiddenSegments.reduce((sum, segment) => sum + segment.value, 0),
          meta: `${hiddenSegments.length} additional accounts`,
        },
      ];

  return mergedSegments.map((segment, index) => ({
    ...segment,
    color: RING_COLORS[index % RING_COLORS.length],
  }));
}

// 15. Plan items build ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildPlanItems(accounts: Account[]): InsightItem[] {
  const total = accounts.length;
  const planCounts = new Map<string, number>();
  for (const account of accounts) {
    const label = formatPlanLabel(account.planType);
    planCounts.set(label, (planCounts.get(label) ?? 0) + 1);
  }
  const toneOrder: InsightTone[] = ["primary", "success", "warning", "neutral", "danger"];
  return [...planCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, count], index) => ({
      label,
      value: count,
      caption: label === "Unknown"
        ? "Plan metadata pending"
        : `${Math.round((count / Math.max(total, 1)) * 100)}% of pool`,
      tone: toneOrder[index % toneOrder.length],
    }));
}

// 16. Status items build ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildStatusItems(accounts: Account[]): InsightItem[] {
  const total = accounts.length;
  const items: InsightItem[] = [];
  for (const status of STATUS_ORDER) {
    const count = accounts.filter((account) => account.status === status).length;
    if (count === 0) {
      continue;
    }
    items.push({
      label: formatStatusLabel(status),
      value: count,
      caption: `${Math.round((count / Math.max(total, 1)) * 100)}% of pool`,
      tone: STATUS_TONES[status],
    });
  }
  return items;
}

// 17. Model coverage build ―――――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildModelCoverageItems(accounts: Account[]): InsightItem[] {
  const supportedModels = new Set<string>();
  const unsupportedModels = new Set<string>();
  let learnedAccounts = 0;
  let pendingAccounts = 0;

  for (const account of accounts) {
    const supported = account.supportedModelIds ?? [];
    const unsupported = account.unsupportedModelIds ?? [];
    if (supported.length > 0 || unsupported.length > 0) {
      learnedAccounts += 1;
    } else {
      pendingAccounts += 1;
    }
    for (const model of supported) {
      supportedModels.add(model);
    }
    for (const model of unsupported) {
      unsupportedModels.add(model);
    }
  }

  return [
    {
      label: "Learned accounts",
      value: learnedAccounts,
      caption: `${pendingAccounts} pending capability checks`,
      tone: learnedAccounts > 0 ? "success" : "neutral",
    },
    {
      label: "Supported models",
      value: supportedModels.size,
      caption: supportedModels.size > 0 ? "Unique upstream-ready models" : "No support learned yet",
      tone: supportedModels.size > 0 ? "primary" : "neutral",
    },
    {
      label: "Blocked models",
      value: unsupportedModels.size,
      caption: unsupportedModels.size > 0 ? "Remembered unsupported requests" : "No blocked models recorded",
      tone: unsupportedModels.size > 0 ? "warning" : "neutral",
    },
  ];
}

// 18. Account model strategy ―――――――――――――――――――――――――――――――――――――――――――――――――――
export function getAccountModelStrategy(account: Account): InsightItem {
  const preferredState = getAccountModelSupport(account, PREFERRED_HIGH_CAPABILITY_MODEL);
  const fallbackState = getAccountModelSupport(account, FALLBACK_HIGH_CAPABILITY_MODEL);
  if (preferredState === "supported") {
    return {
      label: "5.5 ready",
      value: PREFERRED_HIGH_CAPABILITY_MODEL,
      caption: fallbackState === "supported" ? "Preferred and fallback models both learned" : "Preferred high-capability path learned",
      tone: "primary",
    };
  }
  if (fallbackState === "supported") {
    return {
      label: "5.4 fallback",
      value: FALLBACK_HIGH_CAPABILITY_MODEL,
      caption: "Automatic downgrade path available when 5.5 is blocked",
      tone: "warning",
    };
  }
  if (preferredState === "unsupported") {
    return {
      label: "5.5 blocked",
      value: "blocked",
      caption: "Preferred model was explicitly rejected for this account",
      tone: "danger",
    };
  }
  return {
    label: "Learning",
    value: "pending",
    caption: "Model catalog has not been learned for this account yet",
    tone: "neutral",
  };
}

// 19. Runtime model items ――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildRuntimeModelItems(summary: RuntimeSummary | null): InsightItem[] {
  if (summary === null) {
    return [];
  }
  return [
    {
      label: "5.5 ready accounts",
      value: summary.models.preferredReadyAccounts,
      caption: `${summary.models.blockedPreferredAccounts} blocked preferred accounts`,
      tone: summary.models.preferredReadyAccounts > 0 ? "primary" : "warning",
    },
    {
      label: "5.4 fallback accounts",
      value: summary.models.fallbackReadyAccounts,
      caption: `${summary.models.fallbackOnlyAccounts} fallback-only accounts`,
      tone: summary.models.fallbackReadyAccounts > 0 ? "success" : "neutral",
    },
    {
      label: "Capability learning",
      value: summary.counts.learnedAccounts,
      caption: `${summary.counts.unknownCapabilityAccounts} accounts still unlearned`,
      tone: summary.counts.learnedAccounts > 0 ? "success" : "neutral",
    },
  ];
}

// 20. Runtime automation items ―――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildRuntimeAutomationItems(summary: RuntimeSummary | null): InsightItem[] {
  if (summary === null) {
    return [];
  }
  return [
    {
      label: "Preferred model",
      value: summary.settings.preferredHighCapabilityModel,
      caption: `${summary.settings.fallbackHighCapabilityModel} fallback when preferred is not available`,
      tone: "primary",
    },
    {
      label: "Free-plan auto disable",
      value: summary.settings.autoDisableFreePlan ? "on" : "off",
      caption: `${summary.counts.autoDisabledFreeAccounts} accounts auto-disabled`,
      tone: summary.settings.autoDisableFreePlan ? "warning" : "neutral",
    },
    {
      label: "Parallel routing",
      value: summary.settings.parallelConcurrency,
      caption: `${summary.settings.parallelStaggerMs}ms stagger between concurrent launches`,
      tone: summary.settings.parallelConcurrency > 1 ? "success" : "neutral",
    },
  ];
}

// 21. Runtime settings items ―――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildRuntimeSettingsItems(summary: RuntimeSummary | null): InsightItem[] {
  if (summary === null) {
    return [];
  }
  return [
    {
      label: "Request budget",
      value: `${summary.settings.proxyRequestBudgetSeconds}s`,
      caption: summary.settings.globalCooldownEnabled ? "Global cooldown guard enabled" : "Global cooldown guard disabled",
      tone: summary.settings.globalCooldownEnabled ? "success" : "neutral",
    },
    {
      label: "Request body limit",
      value: formatBytes(summary.settings.proxyMaxBodyBytes),
      caption: summary.cooldown.active ? `${summary.cooldown.retryAfterSeconds}s cooldown active` : "Oversized proxy bodies rejected early",
      tone: summary.cooldown.active ? "warning" : "success",
    },
    {
      label: "Usage polling",
      value: `${summary.settings.usagePollIntervalSeconds}s`,
      caption: `${summary.settings.usagePollConcurrency} concurrent with ${summary.settings.usagePollJitterMs}ms jitter`,
      tone: "primary",
    },
    {
      label: "Accounts tracked",
      value: summary.counts.totalAccounts,
      caption: `${summary.counts.autoDisabledFreeAccounts} auto-disabled free accounts`,
      tone: summary.counts.totalAccounts > 0 ? "success" : "neutral",
    },
  ];
}

// 22. Bytes format
function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${Math.round(bytes / 1_048_576)} MiB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KiB`;
  }
  return `${bytes} B`;
}

// 23. Account model support read ―――――――――――――――――――――――――――――――――――――――――――――――――
function getAccountModelSupport(account: Account, model: string): "supported" | "unsupported" | "unknown" {
  if (account.unsupportedModelIds.includes(model)) {
    return "unsupported";
  }
  if (account.supportedModelIds === null) {
    return "unknown";
  }
  return account.supportedModelIds.includes(model) ? "supported" : "unsupported";
}
