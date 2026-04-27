type AccountIdentityLike = {
  id: string;
  email: string | null;
  label: string;
};

// 1. Identity key ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function identityKey(account: AccountIdentityLike): string {
  const email = account.email?.trim().toLowerCase() || "";
  if (email.length > 0) {
    return `email:${email}`;
  }
  const label = account.label.trim().toLowerCase();
  if (label.length > 0) {
    return `label:${label}`;
  }
  return `id:${account.id}`;
}

// 2. Duplicate set build ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function buildDuplicateAccountIdSet<T extends AccountIdentityLike>(accounts: T[]): Set<string> {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    const key = identityKey(account);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const account of accounts) {
    if ((counts.get(identityKey(account)) ?? 0) > 1) {
      duplicates.add(account.id);
    }
  }
  return duplicates;
}

// 3. Account id compact ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatCompactAccountId(accountId: string, headChars = 8, tailChars = 6): string {
  if (accountId.length <= headChars + tailChars + 3) {
    return accountId;
  }
  return `${accountId.slice(0, headChars)}...${accountId.slice(-tailChars)}`;
}
