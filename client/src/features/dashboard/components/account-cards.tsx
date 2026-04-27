import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { AccountCard } from "@/features/dashboard/components/account-card";
import type { Account } from "@/features/shared/schemas";
import { buildDuplicateAccountIdSet } from "@/utils/account-identifiers";
import { formatAccountLabel } from "@/features/dashboard/utils";

export type AccountCardsProps = {
  accounts: Account[];
};

// 1. Account cards ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function AccountCards({ accounts }: AccountCardsProps) {
  const duplicates = buildDuplicateAccountIdSet(accounts.map((account) => ({
    id: account.id,
    email: account.email,
    label: formatAccountLabel(account),
  })));

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No accounts connected yet"
        description="Import or authenticate an account to get started."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((account, index) => (
        <div key={account.id} className="animate-fade-in-up" style={{ animationDelay: `${index * 75}ms` }}>
          <AccountCard account={account} showAccountId={duplicates.has(account.id)} />
        </div>
      ))}
    </div>
  );
}
