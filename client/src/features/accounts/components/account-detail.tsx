import { User } from "lucide-react";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { AccountTokenInfo } from "@/features/accounts/components/account-token-info";
import { AccountUsagePanel } from "@/features/accounts/components/account-usage-panel";
import { StatusBadge } from "@/components/status-badge";
import type { Account } from "@/features/shared/schemas";
import { normalizeStatus } from "@/utils/account-status";
import { formatCompactAccountId } from "@/utils/account-identifiers";
import { formatSlug } from "@/utils/formatters";

export type AccountDetailProps = {
  account: Account | null;
  showAccountId?: boolean;
};

// 1. Account detail ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function AccountDetail({ account, showAccountId = false }: AccountDetailProps) {
  const blurred = usePrivacyStore((state) => state.blurred);

  if (account === null) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <User className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="mt-3 text-sm font-medium text-muted-foreground">Select an account</p>
        <p className="mt-1 text-xs text-muted-foreground/70">Choose an account from the list to inspect details.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">
            {blurred && account.email !== null ? <span className="privacy-blur">{account.email}</span> : account.email ?? account.id}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatSlug(account.planType)}
            {showAccountId ? ` | ID ${formatCompactAccountId(account.id)}` : ""}
          </p>
          {account.chatgptAccountId ? (
            <p className="mt-1 text-xs text-muted-foreground">ChatGPT account: {account.chatgptAccountId}</p>
          ) : null}
        </div>
        <StatusBadge status={normalizeStatus(account.status)} />
      </div>

      <AccountUsagePanel account={account} />
      <AccountTokenInfo account={account} />
    </div>
  );
}
