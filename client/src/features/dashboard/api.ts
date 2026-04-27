import { get, post } from "@/lib/api-client";
import {
  AccountCreateResponseSchema,
  AccountsResponseSchema,
  HealthResponseSchema,
  RuntimeSummarySchema,
  type LoadBalancerSnapshot,
} from "@/features/shared/schemas";

export const SNAPSHOT_QUERY_KEY = ["loadbalancer", "snapshot"] as const;

export type CreateAccountPayload = {
  email: string | null;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  chatgptAccountId: string | null;
  planType: string | null;
};

// 1. Snapshot load ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function getLoadBalancerSnapshot(): Promise<LoadBalancerSnapshot> {
  const [healthPayload, accountsPayload, runtimeSummary] = await Promise.all([
    get("/health/live", HealthResponseSchema),
    get("/api/accounts", AccountsResponseSchema),
    get("/api/runtime-summary", RuntimeSummarySchema).catch(() => null),
  ]);
  return {
    health: healthPayload.status === "ok" ? "ok" : "down",
    accounts: accountsPayload.accounts,
    runtimeSummary,
    updatedAt: new Date().toISOString(),
  };
}

// 2. Global cooldown clear ―――――――――――――――――――――――――――――――――――――――――――――――――――
export function clearGlobalCooldown() {
  return post("/api/global-cooldown/clear", RuntimeSummarySchema);
}

// 3. Account create ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function createAccount(payload: CreateAccountPayload) {
  return post("/api/accounts", AccountCreateResponseSchema, {
    body: payload,
  });
}
