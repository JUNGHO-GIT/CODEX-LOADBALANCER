import { usePrivacyStore } from "@/hooks/use-privacy";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import type { Account } from "@/features/shared/schemas";
import { normalizeStatus } from "@/utils/account-status";
import { formatCompactAccountId } from "@/utils/account-identifiers";
import { formatSlug } from "@/utils/formatters";

export type AccountListItemProps = {
  account: Account;
  selected: boolean;
  showAccountId: boolean;
  onSelect: (accountId: string) => void;
};

// 1. Account list item ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function AccountListItem({ account, selected, showAccountId, onSelect }: AccountListItemProps) {
  const blurred = usePrivacyStore((state) => state.blurred);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full flex-col gap-2 rounded-xl border px-3 py-3 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/8"
          : "border-transparent bg-muted/20 hover:border-border/70 hover:bg-muted/40",
      )}
      onClick={() => {
        onSelect(account.id);
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {blurred && account.email !== null ? <span className="privacy-blur">{account.email}</span> : account.email ?? account.id}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatSlug(account.planType)}
            {showAccountId ? ` | ${formatCompactAccountId(account.id, 5, 4)}` : ""}
          </p>
        </div>
        <StatusBadge status={normalizeStatus(account.status)} />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>{account.supportedModelIds?.length ?? 0} supported models</span>
        <span>{account.errorCount} errors</span>
      </div>
    </button>
  );
}
