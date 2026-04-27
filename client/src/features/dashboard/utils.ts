import { Activity, BadgeHelp, CircleGauge, Layers3, type LucideIcon, ShieldCheck } from "lucide-react";
import type { Account, LoadBalancerSnapshot, RuntimeSummary, SnapshotHistoryPoint } from "@/features/shared/schemas";
import { buildDuplicateAccountIdSet, formatCompactAccountId } from "@/utils/account-identifiers";
import { buildDonutPalette } from "@/utils/colors";
import { formatModelList, formatSlug } from "@/utils/formatters";

export type UsageWindowKey = "primary" | "secondary";
export type MetricTrendKey = "accountCount" | "healthScore" | "preferredReadyAccountCount" | "autoDisabledFreeAccountCount";
export type InsightTone = "primary" | "success" | "warning" | "danger" | "neutral";

export type RemainingItem = {
  accountId: string;
  label: string;
  labelSuffix: string;
  isEmail: boolean;
  value: number;
  remainingPercent: number | null;
  color: string;
};

export type DashboardStat = {
  label: string;
  value: string;
  meta?: string;
  icon: LucideIcon;
  trend: { value: number }[];
  trendColor: string;
};

export type InsightItem = {
  label: string;
  value: string | number;
  caption: string;
  tone: InsightTone;
};

export type DashboardView = {
  stats: DashboardStat[];
  primaryUsageItems: RemainingItem[];
  secondaryUsageItems: RemainingItem[];
  primaryTotal: number;
  secondaryTotal: number;
  planItems: InsightItem[];
  statusItems: InsightItem[];
  runtimeModelItems: InsightItem[];
  runtimeAutomationItems: InsightItem[];
};

const TREND_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b"];

// 1. Account label format ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatAccountLabel(account: Account): string {
  return account.email?.trim() || account.id;
}

// 2. Remaining percent read ―――――――――――――――――――――――――――――――――――――――――――――――――――――
export function getRemainingPercent(account: Account, windowKey: UsageWindowKey): number | null {
  const usedPercent = windowKey === "primary" ? account.usedPercent : account.secondaryUsedPercent;
  if (usedPercent === null || Number.isNaN(usedPercent)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

// 3. Trend values build ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildMetricTrendPoints(history: SnapshotHistoryPoint[], key: MetricTrendKey): { value: number }[] {
  return history.filter((point) => Number.isFinite(point[key])).map((point) => ({ value: point[key] }));
}

// 4. Remaining items build ―――――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildRemainingItems(accounts: Account[], windowKey: UsageWindowKey, isDark = false): RemainingItem[] {
  const palette = buildDonutPalette(accounts.length, isDark);
  const duplicates = buildDuplicateAccountIdSet(accounts.map((account) => ({
    id: account.id,
    email: account.email,
    label: formatAccountLabel(account),
  })));
  const items: RemainingItem[] = [];
  for (const [index, account] of accounts.entries()) {
    const remainingPercent = getRemainingPercent(account, windowKey);
    if (remainingPercent === null) {
      continue;
    }
    items.push({
      accountId: account.id,
      label: formatAccountLabel(account),
      labelSuffix: duplicates.has(account.id) ? ` (${formatCompactAccountId(account.id, 5, 4)})` : "",
      isEmail: account.email !== null && formatAccountLabel(account) === account.email,
      value: remainingPercent,
      remainingPercent,
      color: palette[index % palette.length],
    });
  }
  return items.sort((left, right) => right.value - left.value);
}

// 5. Remaining total sum ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function sumRemaining(items: RemainingItem[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
}

// 6. Dashboard stats build ―――――――――――――――――――――――――――――――――――――――――――――――――――――
function buildDashboardStats(snapshot: LoadBalancerSnapshot, history: SnapshotHistoryPoint[]): DashboardStat[] {
  const runtimeSummary = snapshot.runtimeSummary;
  const limitedCount = snapshot.accounts.filter((account) => account.status === "rate_limited" || account.status === "quota_exceeded").length;
  const weeklySamples = snapshot.accounts.filter((account) => account.secondaryUsedPercent !== null).length;
  return [
    {
      label: "Accounts",
      value: `${snapshot.accounts.length}`,
      meta: `${snapshot.accounts.filter((account) => account.status === "active").length} active`,
      icon: Layers3,
      trend: buildMetricTrendPoints(history, "accountCount"),
      trendColor: TREND_COLORS[0],
    },
    {
      label: "Health",
      value: snapshot.health === "ok" ? "Live" : "Down",
      meta: snapshot.updatedAt,
      icon: Activity,
      trend: buildMetricTrendPoints(history, "healthScore"),
      trendColor: TREND_COLORS[1],
    },
    {
      label: "5.5 ready",
      value: `${runtimeSummary?.models.preferredReadyAccounts ?? 0}`,
      meta: `${limitedCount} accounts currently limited`,
      icon: CircleGauge,
      trend: buildMetricTrendPoints(history, "preferredReadyAccountCount"),
      trendColor: TREND_COLORS[2],
    },
    {
      label: "Free auto-disabled",
      value: `${runtimeSummary?.counts.autoDisabledFreeAccounts ?? 0}`,
      meta: `${Math.max(snapshot.accounts.length - weeklySamples, 0)} accounts missing weekly quota samples`,
      icon: BadgeHelp,
      trend: buildMetricTrendPoints(history, "autoDisabledFreeAccountCount"),
      trendColor: TREND_COLORS[3],
    },
  ];
}

// 7. Plan items build ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function buildPlanItems(accounts: Account[]): InsightItem[] {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    const key = formatSlug(account.planType);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([label, value], index) => ({
    label,
    value,
    caption: index === 0 ? "Most common plan tier" : "Plan distribution slice",
    tone: index === 0 ? "primary" : "neutral",
  }));
}

// 8. Status items build ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function buildStatusItems(accounts: Account[]): InsightItem[] {
  const buckets = [
    { key: "active", label: "Active", tone: "success" as const },
    { key: "paused", label: "Paused", tone: "warning" as const },
    { key: "rate_limited", label: "Rate limited", tone: "warning" as const },
    { key: "quota_exceeded", label: "Quota exceeded", tone: "danger" as const },
    { key: "deactivated", label: "Deactivated", tone: "neutral" as const },
  ];
  return buckets.map((bucket) => {
    const value = accounts.filter((account) => account.status === bucket.key).length;
    return {
      label: bucket.label,
      value,
      caption: value > 0 ? `${value} accounts in this state` : "No accounts in this state",
      tone: bucket.tone,
    };
  });
}

// 9. Runtime model items build ―――――――――――――――――――――――――――――――――――――――――――――――――――
function buildRuntimeModelItems(summary: RuntimeSummary | null): InsightItem[] {
  if (summary === null) {
    return [{
      label: "Runtime summary",
      value: "Unavailable",
      caption: "Backend summary endpoint not ready.",
      tone: "warning",
    }];
  }
  return [
    {
      label: "Preferred model",
      value: summary.settings.preferredHighCapabilityModel,
      caption: `${summary.models.preferredReadyAccounts} accounts ready`,
      tone: "primary",
    },
    {
      label: "Fallback model",
      value: summary.settings.fallbackHighCapabilityModel,
      caption: `${summary.models.fallbackReadyAccounts} accounts ready`,
      tone: "success",
    },
    {
      label: "Fallback only",
      value: summary.models.fallbackOnlyAccounts,
      caption: `${summary.models.blockedPreferredAccounts} blocked on preferred`,
      tone: "warning",
    },
    {
      label: "Observed capabilities",
      value: formatModelList([
        summary.settings.preferredHighCapabilityModel,
        summary.settings.fallbackHighCapabilityModel,
      ]),
      caption: `${summary.counts.learnedAccounts}/${summary.counts.totalAccounts} accounts learned`,
      tone: "neutral",
    },
  ];
}

// 10. Runtime automation items build ――――――――――――――――――――――――――――――――――――――――――――――
function buildRuntimeAutomationItems(summary: RuntimeSummary | null): InsightItem[] {
  if (summary === null) {
    return [{
      label: "Automation",
      value: "Unavailable",
      caption: "No runtime settings loaded.",
      tone: "warning",
    }];
  }
  return [
    {
      label: "Cooldown",
      value: summary.cooldown.active ? "Active" : "Inactive",
      caption: summary.cooldown.retryAfterSeconds === null ? "No global hold" : `${summary.cooldown.retryAfterSeconds}s retry-after`,
      tone: summary.cooldown.active ? "danger" : "success",
    },
    {
      label: "Auto-disable free",
      value: summary.settings.autoDisableFreePlan ? "Enabled" : "Disabled",
      caption: `${summary.counts.autoDisabledFreeAccounts} accounts currently disabled`,
      tone: summary.settings.autoDisableFreePlan ? "warning" : "neutral",
    },
    {
      label: "Usage poll",
      value: `${summary.settings.usagePollIntervalSeconds}s`,
      caption: `${summary.settings.usagePollConcurrency} concurrent workers`,
      tone: "primary",
    },
    {
      label: "Request budget",
      value: `${summary.settings.proxyRequestBudgetSeconds}s`,
      caption: `${summary.settings.proxyMaxBodyBytes.toLocaleString("en-US")} max bytes`,
      tone: "neutral",
    },
  ];
}

// 11. Dashboard view build ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildDashboardView(snapshot: LoadBalancerSnapshot, history: SnapshotHistoryPoint[], isDark = false): DashboardView {
  const primaryUsageItems = buildRemainingItems(snapshot.accounts, "primary", isDark);
  const secondaryUsageItems = buildRemainingItems(snapshot.accounts, "secondary", isDark);
  return {
    stats: buildDashboardStats(snapshot, history),
    primaryUsageItems,
    secondaryUsageItems,
    primaryTotal: sumRemaining(primaryUsageItems),
    secondaryTotal: sumRemaining(secondaryUsageItems),
    planItems: buildPlanItems(snapshot.accounts),
    statusItems: buildStatusItems(snapshot.accounts),
    runtimeModelItems: buildRuntimeModelItems(snapshot.runtimeSummary),
    runtimeAutomationItems: buildRuntimeAutomationItems(snapshot.runtimeSummary),
  };
}

// 12. Panel tone class ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function getToneClass(tone: InsightTone): string {
  if (tone === "success") {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (tone === "warning") {
    return "text-amber-600 dark:text-amber-400";
  }
  if (tone === "danger") {
    return "text-red-600 dark:text-red-400";
  }
  if (tone === "primary") {
    return "text-primary";
  }
  return "text-foreground";
}

// 13. Runtime shield label ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function getRuntimeShieldLabel(summary: RuntimeSummary | null): string {
  if (summary === null) {
    return "Runtime summary unavailable";
  }
  if (summary.cooldown.active) {
    return "Global cooldown active";
  }
  if (!summary.settings.globalCooldownEnabled) {
    return "Global cooldown disabled";
  }
  return "Runtime guard active";
}

export const RuntimeShieldIcon = ShieldCheck;
