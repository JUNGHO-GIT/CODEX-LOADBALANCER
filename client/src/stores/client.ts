import { BarChart3, type Icon, Router, Settings, Users } from "lucide-svelte";

export type TabKey = "dashboard" | "accounts" | "proxy" | "settings";

export type TabItem = {
  key: TabKey;
  label: string;
  icon: typeof Icon;
};

export type ProxyTarget = {
  label: string;
  endpoint: string;
};

const backendBaseUrl = (
  import.meta.env.VITE_APP_SERVER_URL as string | undefined
)?.replace(/\/$/, "") || "http://127.0.0.1:58557";

export const tabs: TabItem[] = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "accounts", label: "Accounts", icon: Users },
  { key: "proxy", label: "Proxy", icon: Router },
  { key: "settings", label: "Settings", icon: Settings },
];

export const proxyTargets: ProxyTarget[] = [
  { label: "Codex backend", endpoint: `${backendBaseUrl}/backend-api/codex` },
  { label: "OpenAI compatible", endpoint: `${backendBaseUrl}/v1` },
];

// 1. Average usage ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function getAverageUsage(values: Array<number | null>): number | null {
  const filteredValues = values.filter((value): value is number => value !== null);
  const average = filteredValues.length > 0 ? filteredValues.reduce((sum, value) => sum + value, 0) / filteredValues.length : null;
  return average;
}
