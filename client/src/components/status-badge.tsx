import { cn } from "@/lib/utils";
import { STATUS_DOT, type DashboardAccountStatus } from "@/utils/account-status";
import { STATUS_LABELS } from "@/utils/constants";

const statusClassMap: Record<DashboardAccountStatus, string> = {
  active: "border-emerald-500/20 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  paused: "border-amber-500/20 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  limited: "border-orange-500/20 bg-orange-500/15 text-orange-700 dark:text-orange-400",
  exceeded: "border-red-500/20 bg-red-500/15 text-red-700 dark:text-red-400",
  deactivated: "border-zinc-500/20 bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

const normalizedStatusLabelMap: Record<DashboardAccountStatus, string> = {
  active: STATUS_LABELS.active,
  paused: STATUS_LABELS.paused,
  limited: STATUS_LABELS.rate_limited,
  exceeded: STATUS_LABELS.quota_exceeded,
  deactivated: STATUS_LABELS.deactivated,
};

export type StatusBadgeProps = {
  status: DashboardAccountStatus;
};

// 1. Status badge ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium", statusClassMap[status])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} aria-hidden />
      {normalizedStatusLabelMap[status]}
    </span>
  );
}
