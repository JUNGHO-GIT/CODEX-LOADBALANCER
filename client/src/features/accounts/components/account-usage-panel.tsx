import type { Account } from "@/features/shared/schemas";
import { formatDateTimeInline, formatModelList, formatPercentNullable } from "@/utils/formatters";
import { cn } from "@/lib/utils";
import { quotaBarColor, quotaBarTrack } from "@/utils/account-status";

export type AccountUsagePanelProps = {
  account: Account;
};

// 1. Usage meter ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function UsageMeter({ label, remainingPercent, resetAt }: { label: string; remainingPercent: number | null; resetAt: number | null }) {
  const clamped = remainingPercent === null ? 0 : Math.max(0, Math.min(100, remainingPercent));

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold">{formatPercentNullable(remainingPercent)}</span>
      </div>
      <div className={cn("mt-3 h-2 overflow-hidden rounded-full", quotaBarTrack(clamped))}>
        <div className={cn("h-full rounded-full", quotaBarColor(clamped))} style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Reset: {formatDateTimeInline(resetAt === null ? null : resetAt * 1000)}
      </p>
    </div>
  );
}

// 2. Account usage panel ――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function AccountUsagePanel({ account }: AccountUsagePanelProps) {
  const primaryRemaining = account.usedPercent === null ? null : Math.max(0, 100 - account.usedPercent);
  const secondaryRemaining = account.secondaryUsedPercent === null ? null : Math.max(0, 100 - account.secondaryUsedPercent);

  return (
    <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <UsageMeter label="Primary window" remainingPercent={primaryRemaining} resetAt={account.resetAt} />
        <UsageMeter label="Secondary window" remainingPercent={secondaryRemaining} resetAt={account.cooldownUntil} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
          <p className="text-sm font-medium">Supported models</p>
          <p className="mt-2 text-xs text-muted-foreground">{formatModelList(account.supportedModelIds)}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
          <p className="text-sm font-medium">Unsupported models</p>
          <p className="mt-2 text-xs text-muted-foreground">{formatModelList(account.unsupportedModelIds)}</p>
        </div>
      </div>
    </section>
  );
}
