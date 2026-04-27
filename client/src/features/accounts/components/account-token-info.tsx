import type { Account } from "@/features/shared/schemas";
import { formatDateTimeInline } from "@/utils/formatters";

export type AccountTokenInfoProps = {
  account: Account;
};

// 1. Token label read ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function hasToken(value: string | undefined): string {
  return value && value.length > 0 ? "Stored" : "Missing";
}

// 2. Meta row ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
    </div>
  );
}

// 3. Account token info ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function AccountTokenInfo({ account }: AccountTokenInfoProps) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <MetaRow label="Access token" value={hasToken(account.accessTokenEncrypted)} />
      <MetaRow label="Refresh token" value={hasToken(account.refreshTokenEncrypted)} />
      <MetaRow label="ID token" value={hasToken(account.idTokenEncrypted)} />
      <MetaRow label="Last refresh" value={formatDateTimeInline(account.lastRefresh)} />
      <MetaRow label="Last selected" value={formatDateTimeInline(account.lastSelectedAt === null ? null : account.lastSelectedAt * 1000)} />
      <MetaRow label="Error count" value={`${account.errorCount}`} />
    </section>
  );
}
