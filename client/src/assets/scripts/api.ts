export type AccountStatus = "active" | "paused" | "rate_limited" | "quota_exceeded" | "deactivated";

export type Account = {
  id: string;
  email: string | null;
  chatgptAccountId: string | null;
  planType: string | null;
  supportedModelIds: string[] | null;
  unsupportedModelIds: string[];
  status: AccountStatus;
  deactivationReason: string | null;
  usedPercent: number | null;
  secondaryUsedPercent: number | null;
  resetAt: number | null;
  cooldownUntil: number | null;
  lastRefresh: string;
  lastSelectedAt: number | null;
  errorCount: number;
  lastErrorAt: number | null;
};

export type ClientSnapshot = {
  health: "ok" | "down";
  accounts: Account[];
  runtimeSummary: RuntimeSummary | null;
  updatedAt: Date | null;
  error: string | null;
};

export type SnapshotHistoryPoint = {
  timestamp: number;
  accountCount: number;
  activeAccountCount: number;
  healthScore: number;
  preferredReadyAccountCount: number;
  autoDisabledFreeAccountCount: number;
};

export type RuntimeSummary = {
  settings: {
    proxyRequestBudgetSeconds: number;
    proxyMaxBodyBytes: number;
    parallelConcurrency: number;
    parallelStaggerMs: number;
    globalCooldownEnabled: boolean;
    usagePollIntervalSeconds: number;
    usagePollConcurrency: number;
    usagePollJitterMs: number;
    autoDisableFreePlan: boolean;
    preferredHighCapabilityModel: string;
    fallbackHighCapabilityModel: string;
  };
  cooldown: {
    active: boolean;
    retryAfterSeconds: number | null;
    until: number | null;
    reason: string | null;
  };
  counts: {
    totalAccounts: number;
    activeAccounts: number;
    autoDisabledFreeAccounts: number;
    learnedAccounts: number;
    unknownCapabilityAccounts: number;
  };
  models: {
    preferredReadyAccounts: number;
    fallbackReadyAccounts: number;
    fallbackOnlyAccounts: number;
    blockedPreferredAccounts: number;
    blockedFallbackAccounts: number;
  };
};

const defaultSnapshot: ClientSnapshot = {
  health: "down",
  accounts: [],
  runtimeSummary: null,
  updatedAt: null,
  error: null,
};

const FETCH_TIMEOUT_MS = 10_000;

// 1. JSON fetch ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function fetchJson<T>(requestPath: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  let payload: T;
  try {
    const response = await fetch(requestPath, {
      ...init,
      headers: {
        "Accept": "application/json",
        ...init.headers,
      },
      signal: controller.signal,
    });
    if (response.ok) {
      payload = (await response.json()) as T;
    }
    else {
      throw new Error(`${response.status} ${response.statusText}`);
    }
  }
  finally {
    window.clearTimeout(timeoutId);
  }
  return payload;
}

// 2. Snapshot load ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function loadSnapshot(): Promise<ClientSnapshot> {
  let snapshot = defaultSnapshot;
  try {
    const [healthPayload, accountsPayload, runtimeSummary] = await Promise.all([
      fetchJson<{ status?: string }>("/health/live"),
      fetchJson<{ accounts?: Account[] }>("/api/accounts"),
      fetchJson<RuntimeSummary>("/api/runtime-summary").catch(() => null),
    ]);
    snapshot = {
      health: healthPayload.status === "ok" ? "ok" : "down",
      accounts: accountsPayload.accounts ?? [],
      runtimeSummary,
      updatedAt: new Date(),
      error: null,
    };
  }
  catch (error) {
    snapshot = {
      ...defaultSnapshot,
      updatedAt: new Date(),
      error: snapshotErrorMessage(error),
    };
  }
  return snapshot;
}

// 3. Global cooldown clear ――――――――――――――――――――――――――――――――――――――――――――――――――
export async function clearGlobalCooldown(): Promise<RuntimeSummary> {
  return await fetchJson<RuntimeSummary>("/api/global-cooldown/clear", {
    method: "POST",
  });
}

// 4. Error message
function snapshotErrorMessage(error: unknown): string {
  let message = "Request failed";
  if (error instanceof DOMException && error.name === "AbortError") {
    message = `Request timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s`;
  }
  else if (error instanceof Error) {
    message = error.message;
  }
  return message;
}

// 5. Date format ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatTime(value: Date | number | string | null): string {
  let formatted = "Never";
  if (value !== null) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      formatted = new Intl.DateTimeFormat("en", {
        "dateStyle": "medium",
        "timeStyle": "short",
      }).format(date);
    }
  }
  return formatted;
}

// 6. Percent format ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatPercent(value: number | null): string {
  const formatted = value === null ? "n/a" : `${Math.round(value)}%`;
  return formatted;
}

// 7. Snapshot history point create ――――――――――――――――――――――――――――――――――――――――――――――
export function createSnapshotHistoryPoint(snapshot: ClientSnapshot): SnapshotHistoryPoint {
  const activeAccountCount = snapshot.accounts.filter((account) => account.status === "active").length;
  const point: SnapshotHistoryPoint = {
    timestamp: Date.now(),
    accountCount: snapshot.accounts.length,
    activeAccountCount,
    healthScore: snapshot.health === "ok" ? 100 : 0,
    preferredReadyAccountCount: snapshot.runtimeSummary?.models.preferredReadyAccounts ?? 0,
    autoDisabledFreeAccountCount: snapshot.runtimeSummary?.counts.autoDisabledFreeAccounts ?? 0,
  };
  return point;
}
