import { ArrowUpRight, Clock3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "@/components/status-badge";
import type { Account } from "@/features/shared/schemas";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { cn } from "@/lib/utils";
import { formatCompactAccountId } from "@/utils/account-identifiers";
import { normalizeStatus, quotaBarColor, quotaBarTrack } from "@/utils/account-status";
import { formatDateTimeInline, formatPercentNullable, formatResetLabel, formatSlug } from "@/utils/formatters";

export type AccountCardProps = {
  account: Account;
  showAccountId?: boolean;
};

// 1. Quota bar ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function QuotaBar({ label, percent, resetLabel }: { label: string; percent: number | null; resetLabel: string }) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn(
          "tabular-nums font-medium",
          percent === null
            ? "text-muted-foreground"
            : clamped >= 70
              ? "text-emerald-600 dark:text-emerald-400"
              : clamped >= 30
                ? "text-amber-600 dark:text-amber-400"
                : "text-red-600 dark:text-red-400",
        )}
        >
          {formatPercentNullable(percent)}
        </span>
      </div>
      <div className={cn("h-1.5 w-full overflow-hidden rounded-full", quotaBarTrack(clamped))}>
        <div className={cn("h-full rounded-full transition-all duration-500 ease-out", quotaBarColor(clamped))} style={{ width: `${clamped}%` }} />
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock3 className="h-3 w-3 shrink-0" />
        <span>{resetLabel}</span>
      </div>
    </div>
  );
}

// 2. Account card ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function AccountCard({ account, showAccountId = false }: AccountCardProps) {
  const navigate = useNavigate();
  const blurred = usePrivacyStore((state) => state.blurred);
  const title = account.email ?? account.id;
  const compactId = formatCompactAccountId(account.id);
  const primaryRemaining = account.usedPercent === null ? null : Math.max(0, 100 - account.usedPercent);
  const secondaryRemaining = account.secondaryUsedPercent === null ? null : Math.max(0, 100 - account.secondaryUsedPercent);

  return (
    <div className="card-hover rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            {blurred && account.email !== null ? <span className="privacy-blur">{title}</span> : title}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatSlug(account.planType)}
            {showAccountId ? ` | ID ${compactId}` : ""}
          </p>
        </div>
        <StatusBadge status={normalizeStatus(account.status)} />
      </div>

      <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
        <QuotaBar label="5h" percent={primaryRemaining} resetLabel={formatResetLabel(account.resetAt)} />
        <QuotaBar label="Weekly" percent={secondaryRemaining} resetLabel={formatDateTimeInline(account.cooldownUntil === null ? null : account.cooldownUntil * 1000)} />
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <span>{account.errorCount} errors tracked</span>
        <button
          type="button"
          className="press-scale inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-foreground transition-colors hover:bg-muted"
          onClick={() => {
            navigate(`/accounts?selected=${account.id}`);
          }}
        >
          Details
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
