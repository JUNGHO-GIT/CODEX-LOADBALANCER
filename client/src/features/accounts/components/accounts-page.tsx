import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertMessage } from "@/components/alert-message";
import { AccountAddDialog } from "@/features/accounts/components/account-add-dialog";
import { AccountDetail } from "@/features/accounts/components/account-detail";
import { AccountList } from "@/features/accounts/components/account-list";
import { useAccounts } from "@/features/accounts/hooks/use-accounts";
import { buildDuplicateAccountIdSet } from "@/utils/account-identifiers";
import { formatAccountLabel } from "@/features/dashboard/utils";

// 1. Accounts page ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { snapshotQuery, createMutation } = useAccounts();
  const [dialogOpen, setDialogOpen] = useState(false);

  const accounts = useMemo(() => snapshotQuery.data?.accounts ?? [], [snapshotQuery.data?.accounts]);
  const selectedAccountId = searchParams.get("selected");
  const duplicateAccountIds = useMemo(() => buildDuplicateAccountIdSet(accounts.map((account) => ({
    id: account.id,
    email: account.email,
    label: formatAccountLabel(account),
  }))), [accounts]);

  const resolvedSelectedAccountId = useMemo(() => {
    if (accounts.length === 0) {
      return null;
    }
    if (selectedAccountId && accounts.some((account) => account.id === selectedAccountId)) {
      return selectedAccountId;
    }
    return accounts[0].id;
  }, [accounts, selectedAccountId]);

  const selectedAccount = useMemo(() => {
    return resolvedSelectedAccountId ? accounts.find((account) => account.id === resolvedSelectedAccountId) ?? null : null;
  }, [accounts, resolvedSelectedAccountId]);

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Reference-style account explorer rebuilt for local token import flow.</p>
      </div>

      {snapshotQuery.error instanceof Error ? (
        <AlertMessage variant="error">{snapshotQuery.error.message}</AlertMessage>
      ) : null}

      {createMutation.error instanceof Error ? (
        <AlertMessage variant="error">{createMutation.error.message}</AlertMessage>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="rounded-xl border bg-card p-4">
          <AccountList
            accounts={accounts}
            selectedAccountId={resolvedSelectedAccountId}
            refreshing={snapshotQuery.isFetching}
            onSelect={(accountId) => {
              const nextSearchParams = new URLSearchParams(searchParams);
              nextSearchParams.set("selected", accountId);
              setSearchParams(nextSearchParams);
            }}
            onRefresh={() => {
              void snapshotQuery.refetch();
            }}
            onOpenCreate={() => {
              setDialogOpen(true);
            }}
          />
        </div>

        <AccountDetail
          account={selectedAccount}
          showAccountId={selectedAccount ? duplicateAccountIds.has(selectedAccount.id) : false}
        />
      </div>

      <AccountAddDialog
        open={dialogOpen}
        busy={createMutation.isPending}
        error={createMutation.error instanceof Error ? createMutation.error.message : null}
        onClose={() => {
          setDialogOpen(false);
        }}
        onSubmit={async (payload) => {
          const result = await createMutation.mutateAsync(payload);
          setDialogOpen(false);
          const nextSearchParams = new URLSearchParams(searchParams);
          nextSearchParams.set("selected", result.id);
          setSearchParams(nextSearchParams);
        }}
      />
    </div>
  );
}
