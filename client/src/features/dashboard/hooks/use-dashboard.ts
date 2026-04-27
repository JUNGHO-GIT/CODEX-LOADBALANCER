import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearGlobalCooldown,
  getLoadBalancerSnapshot,
  SNAPSHOT_QUERY_KEY,
} from "@/features/dashboard/api";
import type { LoadBalancerSnapshot, SnapshotHistoryPoint } from "@/features/shared/schemas";

const SNAPSHOT_HISTORY_STORAGE_KEY = "codex-loadbalancer:snapshot-history";
const SNAPSHOT_HISTORY_LIMIT = 24;

// 1. History point check ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function isHistoryPoint(value: unknown): value is SnapshotHistoryPoint {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.sourceUpdatedAt === "string" &&
    typeof record.timestamp === "number" &&
    typeof record.accountCount === "number" &&
    typeof record.activeAccountCount === "number" &&
    typeof record.healthScore === "number" &&
    typeof record.preferredReadyAccountCount === "number" &&
    typeof record.autoDisabledFreeAccountCount === "number"
  );
}

// 2. History read ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function readHistory(): SnapshotHistoryPoint[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_HISTORY_STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isHistoryPoint).slice(-SNAPSHOT_HISTORY_LIMIT) : [];
  }
  catch {
    return [];
  }
}

// 3. History write ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function writeHistory(history: SnapshotHistoryPoint[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SNAPSHOT_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

// 4. History point create ――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function createSnapshotHistoryPoint(snapshot: LoadBalancerSnapshot): SnapshotHistoryPoint {
  const activeAccountCount = snapshot.accounts.filter((account) => account.status === "active").length;
  return {
    sourceUpdatedAt: snapshot.updatedAt,
    timestamp: Date.now(),
    accountCount: snapshot.accounts.length,
    activeAccountCount,
    healthScore: snapshot.health === "ok" ? 100 : 0,
    preferredReadyAccountCount: snapshot.runtimeSummary?.models.preferredReadyAccounts ?? 0,
    autoDisabledFreeAccountCount: snapshot.runtimeSummary?.counts.autoDisabledFreeAccounts ?? 0,
  };
}

// 5. Snapshot query ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function useLoadBalancerSnapshot() {
  return useQuery({
    queryKey: SNAPSHOT_QUERY_KEY,
    queryFn: getLoadBalancerSnapshot,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

// 6. Snapshot history hook ――――――――――――――――――――――――――――――――――――――――――――――――――――
export function useSnapshotHistory(snapshot: LoadBalancerSnapshot | undefined) {
  const [history, setHistory] = useState<SnapshotHistoryPoint[]>(() => readHistory());

  useEffect(() => {
    if (snapshot === undefined) {
      return;
    }
    const nextPoint = createSnapshotHistoryPoint(snapshot);
    setHistory((current) => {
      if (current.at(-1)?.sourceUpdatedAt === nextPoint.sourceUpdatedAt) {
        return current;
      }
      const nextHistory = [...current, nextPoint].slice(-SNAPSHOT_HISTORY_LIMIT);
      writeHistory(nextHistory);
      return nextHistory;
    });
  }, [snapshot]);

  const clearHistory = () => {
    writeHistory([]);
    setHistory([]);
  };

  return {
    history,
    clearHistory,
  };
}

// 7. Global cooldown hook ――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function useClearGlobalCooldown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearGlobalCooldown,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_QUERY_KEY });
    },
  });
}

// 8. Snapshot summary memo ―――――――――――――――――――――――――――――――――――――――――――――――――――――
export function useSnapshotSummary(snapshot: LoadBalancerSnapshot | undefined) {
  return useMemo(() => {
    if (snapshot === undefined) {
      return null;
    }
    return {
      activeAccounts: snapshot.accounts.filter((account) => account.status === "active").length,
      limitedAccounts: snapshot.accounts.filter((account) => account.status === "rate_limited" || account.status === "quota_exceeded").length,
      weeklyQuotaSamples: snapshot.accounts.filter((account) => account.secondaryUsedPercent !== null).length,
      primaryQuotaSamples: snapshot.accounts.filter((account) => account.usedPercent !== null).length,
    };
  }, [snapshot]);
}
