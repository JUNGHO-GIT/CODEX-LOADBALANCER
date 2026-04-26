<script lang="ts">
  
  import { clearGlobalCooldown, type ClientSnapshot, createSnapshotHistoryPoint, loadSnapshot, type SnapshotHistoryPoint } from "@assets/scripts/api";
  import AlertBand from "@interfaces/components/AlertBand.svelte";
  import AppHeader from "@interfaces/layouts/AppHeader.svelte";
  import TabStrip from "@interfaces/layouts/TabStrip.svelte";
  import Accounts from "@pages/Accounts.svelte";
  import Dashboard from "@pages/Dashboard.svelte";
  import Proxy from "@pages/Proxy.svelte";
  import Settings from "@pages/Settings.svelte";
  import { type TabKey, tabs } from "@stores/client";
import { onMount } from "svelte";

  const AUTO_REFRESH_INTERVAL_MS = 30_000;
  const SNAPSHOT_HISTORY_LIMIT = 18;
  const SNAPSHOT_HISTORY_STORAGE_KEY = "codex-loadbalancer:snapshot-history";

  let selectedTab: TabKey = "dashboard";
  let loading = true;
  let refreshInFlight = false;
  let snapshotHistory: SnapshotHistoryPoint[] = [];
  let snapshot: ClientSnapshot = {
    health: "down",
    accounts: [],
    runtimeSummary: null,
    updatedAt: null,
    error: null,
  };

  // 1. Tab select ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
  function selectTab(nextTab: TabKey): void {
    selectedTab = nextTab;
    window.location.hash = nextTab;
  }

  // 2. Hash sync ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
  function syncTabFromHash(): void {
    const hashTab = window.location.hash.replace("#", "") as TabKey;
    const matchedTab = tabs.some((tab) => tab.key === hashTab) ? hashTab : "dashboard";
    selectedTab = matchedTab;
  }

  // 3. Snapshot history point check ――――――――――――――――――――――――――――――――――――――――――――
  function isSnapshotHistoryPoint(value: unknown): value is SnapshotHistoryPoint {
    let isHistoryPoint = false;
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      isHistoryPoint = [
        "timestamp",
        "accountCount",
        "activeAccountCount",
        "healthScore",
        "preferredReadyAccountCount",
        "autoDisabledFreeAccountCount",
      ].every((key) => typeof record[key] === "number" && Number.isFinite(record[key]));
    }
    return isHistoryPoint;
  }

  // 4. Snapshot history read ―――――――――――――――――――――――――――――――――――――――――――――――――――
  function readSnapshotHistory(): SnapshotHistoryPoint[] {
    let history: SnapshotHistoryPoint[] = [];
    try {
      const rawHistory = window.localStorage.getItem(SNAPSHOT_HISTORY_STORAGE_KEY);
      const parsedHistory = rawHistory === null ? [] : JSON.parse(rawHistory) as unknown;
      history = Array.isArray(parsedHistory)
        ? parsedHistory.filter(isSnapshotHistoryPoint).slice(-SNAPSHOT_HISTORY_LIMIT)
        : [];
    }
    catch {
      history = [];
    }
    return history;
  }

  // 5. Snapshot history write ――――――――――――――――――――――――――――――――――――――――――――――――――
  function writeSnapshotHistory(history: SnapshotHistoryPoint[]): void {
    try {
      window.localStorage.setItem(SNAPSHOT_HISTORY_STORAGE_KEY, JSON.stringify(history));
    }
    catch {
      // storage unavailable
    }
  }

  // 6. Snapshot history clear ―――――――――――――――――――――――――――――――――――――――――――――――
  function clearSnapshotHistory(): void {
    snapshotHistory = [];
    writeSnapshotHistory([]);
  }

  // 7. Global cooldown clear ―――――――――――――――――――――――――――――――――――――――――――――――――
  async function handleClearGlobalCooldown(): Promise<void> {
    try {
      const runtimeSummary = await clearGlobalCooldown();
      snapshot = {
        ...snapshot,
        runtimeSummary,
        updatedAt: new Date(),
        error: null,
      };
    }
    catch (error) {
      snapshot = {
        ...snapshot,
        updatedAt: new Date(),
        error: error instanceof Error ? error.message : "Cooldown clear failed",
      };
    }
  }

  // 8. Snapshot history remember ―――――――――――――――――――――――――――――――――――――――――――――――
  function rememberSnapshot(nextSnapshot: ClientSnapshot): void {
    const nextPoint = createSnapshotHistoryPoint(nextSnapshot);
    const nextHistory = snapshotHistory.length === 0
      ? [
          {
            ...nextPoint,
            timestamp: nextPoint.timestamp - AUTO_REFRESH_INTERVAL_MS,
          },
          nextPoint,
        ]
      : [
          ...snapshotHistory,
          nextPoint,
        ].slice(-SNAPSHOT_HISTORY_LIMIT);
    snapshotHistory = nextHistory;
    writeSnapshotHistory(nextHistory);
  }

  // 9. Snapshot refresh ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
  async function refreshSnapshot(showLoading = true): Promise<void> {
    if (!refreshInFlight) {
      refreshInFlight = true;
      loading = showLoading;
      const nextSnapshot = await loadSnapshot();
      snapshot = nextSnapshot;
      rememberSnapshot(nextSnapshot);
      loading = false;
      refreshInFlight = false;
    }
  }

  onMount(() => {
    syncTabFromHash();
    snapshotHistory = readSnapshotHistory();
    void refreshSnapshot();
    const refreshTimer = window.setInterval(() => {
      void refreshSnapshot(false);
    }, AUTO_REFRESH_INTERVAL_MS);
    window.addEventListener("hashchange", syncTabFromHash);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("hashchange", syncTabFromHash);
    };
  });
</script>

<svelte:head>
  <title>CODEX LoadBalancer Client</title>
</svelte:head>

<main class="app-shell">
  <AppHeader health={snapshot.health} {loading} onRefresh={refreshSnapshot} />
  <TabStrip {selectedTab} {tabs} onSelect={selectTab} />

  {#if snapshot.error}
    <AlertBand message={snapshot.error} />
  {/if}

  {#if selectedTab === "dashboard"}
    <Dashboard {snapshot} {snapshotHistory} />
  {:else if selectedTab === "accounts"}
    <Accounts {snapshot} />
  {:else if selectedTab === "proxy"}
    <Proxy {snapshot} />
  {:else}
    <Settings {snapshot} {snapshotHistory} onClearHistory={clearSnapshotHistory} onClearGlobalCooldown={handleClearGlobalCooldown} />
  {/if}
</main>
