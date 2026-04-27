import { Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AccountListItem } from "@/features/accounts/components/account-list-item";
import type { Account } from "@/features/shared/schemas";
import { buildDuplicateAccountIdSet } from "@/utils/account-identifiers";
import { formatAccountLabel } from "@/features/dashboard/utils";

export type AccountListProps = {
  accounts: Account[];
  selectedAccountId: string | null;
  refreshing: boolean;
  onSelect: (accountId: string) => void;
  onRefresh: () => void;
  onOpenCreate: () => void;
};

// 1. Account list ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function AccountList({
  accounts,
  selectedAccountId,
  refreshing,
  onSelect,
  onRefresh,
  onOpenCreate,
}: AccountListProps) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return accounts.filter((account) => {
      if (needle.length === 0) {
        return true;
      }
      return [
        account.email ?? "",
        account.id,
        account.planType ?? "",
        account.chatgptAccountId ?? "",
      ].some((field) => field.toLowerCase().includes(needle));
    });
  }, [accounts, search]);

  const duplicateAccountIds = useMemo(() => buildDuplicateAccountIdSet(accounts.map((account) => ({
    id: account.id,
    email: account.email,
    label: formatAccountLabel(account),
  }))), [accounts]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            className="h-9 w-full rounded-full border border-border/60 bg-background px-9 text-sm outline-none transition-colors focus:border-primary/50"
            placeholder="Search accounts..."
          />
        </div>
        <button
          type="button"
          className="press-scale inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground transition-colors hover:text-foreground"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4${refreshing ? " animate-spin" : ""}`} />
        </button>
      </div>

      <button
        type="button"
        className="press-scale inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-sm font-semibold text-primary-foreground"
        onClick={onOpenCreate}
      >
        <Plus className="h-4 w-4" />
        Add account
      </button>

      <div className="max-h-[calc(100vh-18rem)] space-y-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            No matching accounts.
          </div>
        ) : (
          filtered.map((account) => (
            <AccountListItem
              key={account.id}
              account={account}
              selected={account.id === selectedAccountId}
              showAccountId={duplicateAccountIds.has(account.id)}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
