import type { Settings } from "../assets/scripts/config.ts";
import type { Account } from "../assets/type/domain/common.ts";
import type { Store } from "../repositories/store.ts";

export const FPDR =
  "Automatically deactivated because free-plan accounts are excluded from the balancer";

export declare type AccountIdentity = {
  email: string | null;
  chatgptAccountId: string | null;
  planType: string | null;
};

// 1. Account identity extract ―――――――――――――――――――――――――――――――――――――――――――――――――――
export function extractAccountIdentity(tokens: {
  idToken?: string | null;
  accessToken?: string | null;
}): AccountIdentity {
  const idClaims = readJwtClaims(tokens.idToken ?? null);
  const accessClaims = readJwtClaims(tokens.accessToken ?? null);
  const authClaims = objectValue(
    accessClaims?.["https://api.openai.com/auth"] ??
      idClaims?.["https://api.openai.com/auth"],
  );
  const prflClms = objectValue(accessClaims?.["https://api.openai.com/profile"]);
  return {
    email:
      stringValue(idClaims?.email) ??
      stringValue(accessClaims?.email) ??
      stringValue(prflClms?.email),
    chatgptAccountId: stringValue(authClaims?.chatgpt_account_id),
    planType: normalizePlanType(stringValue(authClaims?.chatgpt_plan_type)),
  };
}

// 2. Plan type extract ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function extractPlanType(payload: unknown): string | null {
  const record = objectValue(payload);
  const error = objectValue(record?.error);
  return normalizePlanType(
    stringValue(record?.plan_type) ?? stringValue(error?.plan_type),
  );
}

// 3. Free plan check ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function isFreePlan(planType: string | null): boolean {
  const normalized = normalizePlanType(planType);
  return normalized?.includes("free") ?? false;
}

// 4. Plan normalize ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function normalizePlanType(planType: string | null): string | null {
  if (typeof planType !== "string") {
    return null;
  }
  const normalized = planType.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

// 5. Balancer exclusion check ――――――――――――――――――――――――――――――――――――――――――――――――――
export function isBalancerExcludedAccount(account: Pick<Account, "planType">): boolean {
  return isFreePlan(account.planType);
}

// 6. Auto-disabled free-plan check ――――――――――――――――――――――――――――――――――――――――――――
export function isAutoDisabledFreePlanAccount(
  account: Pick<Account, "status" | "deactivationReason">,
): boolean {
  return (
    account.status === "deactivated" &&
    account.deactivationReason === FPDR
  );
}

// 7. Free-plan reevaluate check ―――――――――――――――――――――――――――――――――――――――――――――――
export function shouldReevaluateFreePlanAccount(
  account: Pick<Account, "status" | "planType" | "deactivationReason">,
): boolean {
  return isFreePlan(account.planType) || isAutoDisabledFreePlanAccount(account);
}

// 8. Account plan policy apply ―――――――――――――――――――――――――――――――――――――――――――――――――
export function applyAccountPlanPolicy(
  account: Account,
  atDsblFrPln: boolean,
): Account {
  const nextPlanType = normalizePlanType(account.planType);
  const nextAccount =
    nextPlanType === account.planType ? account : { ...account, planType: nextPlanType };
  const isAtOff = nextAccount.deactivationReason === FPDR;

  if (!atDsblFrPln || !isFreePlan(nextPlanType)) {
    if (!isAtOff) {
      return nextAccount;
    }
    return {
      ...nextAccount,
      status: "active",
      deactivationReason: null,
    };
  }

  if (nextAccount.status === "deactivated" && !isAtOff) {
    return nextAccount;
  }
  if (
    nextAccount.status === "deactivated" &&
    nextAccount.deactivationReason === FPDR
  ) {
    return nextAccount;
  }
  return {
    ...nextAccount,
    status: "deactivated",
    deactivationReason: FPDR,
  };
}

// 9. Account policy reconcile ―――――――――――――――――――――――――――――――――――――――――――――――――――
export async function reconcileAccountPolicies(
  store: Store,
  settings: Pick<Settings, "autoDisableFreePlan">,
): Promise<number> {
  const accounts = await store.listAccounts();
  let updatedCount = 0;
  for (const account of accounts) {
    const nextAccount = applyAccountPlanPolicy(
      account,
      settings.autoDisableFreePlan,
    );
    if (JSON.stringify(nextAccount) === JSON.stringify(account)) {
      continue;
    }
    await store.upsertAccount(nextAccount);
    updatedCount += 1;
  }
  return updatedCount;
}

// 10. JWT claims read ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function readJwtClaims(token: string | null): Record<string, unknown> | null {
  if (token === null) {
    return null;
  }
  const parts = token.split(".");
  const payload = parts[1];
  if (payload === undefined) {
    return null;
  }
  try {
    const json = Buffer.from(toBase64(payload), "base64").toString("utf8");
    return objectValue(JSON.parse(json));
  } catch {
    return null;
  }
}

// 11. Base64url normalize ―――――――――――――――――――――――――――――――――――――――――――――――――――――
function toBase64(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = normalized.length % 4;
  if (padding === 0) {
    return normalized;
  }
  return normalized.padEnd(normalized.length + (4 - padding), "=");
}

// 12. Object value ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

// 13. String value ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
