<script lang="ts">
  
  import { type Account, type ClientSnapshot, formatPercent, formatTime, type SnapshotHistoryPoint } from "@assets/scripts/api";
  import {
    buildAccountPoolSegments,
    buildFreePlanSegments,
    buildHealthSegments,
    buildMetricTrendPoints,
    buildModelReadinessSegments,
    buildPlanItems,
    buildRuntimeAutomationItems,
    buildRuntimeModelItems,
    buildStatusItems,
    buildUsageSegments,
    getAverageRemaining,
    getRemainingPercent,
  } from "@assets/scripts/insights";
  import EndpointList from "@interfaces/components/EndpointList.svelte";
  import InsightPanel from "@interfaces/components/InsightPanel.svelte";
  import MetricCard from "@interfaces/components/MetricCard.svelte";
  import RingChartCard from "@interfaces/components/RingChartCard.svelte";
  import { proxyTargets } from "@stores/client";
import { Activity, BadgeHelp, CheckCircle2, CircleGauge, Layers3, Users } from "lucide-svelte";

  export let snapshot: ClientSnapshot;
  export let snapshotHistory: SnapshotHistoryPoint[] = [];

  $: accounts = snapshot.accounts;
  $: activeAccounts = accounts.filter((account: Account) => account.status === "active");
  $: limitedAccounts = accounts.filter((account: Account) => account.status === "rate_limited" || account.status === "quota_exceeded");
  $: runtimeSummary = snapshot.runtimeSummary;
  $: preferredReadyCount = runtimeSummary?.models.preferredReadyAccounts ?? 0;
  $: autoDisabledCount = runtimeSummary?.counts.autoDisabledFreeAccounts ?? 0;
  $: averagePrimaryRemaining = getAverageRemaining(accounts, "primary");
  $: averageSecondaryRemaining = getAverageRemaining(accounts, "secondary");
  $: primaryUsageSegments = buildUsageSegments(accounts, "primary");
  $: secondaryUsageSegments = buildUsageSegments(accounts, "secondary");
  $: accountPoolSegments = buildAccountPoolSegments(accounts);
  $: healthSegments = buildHealthSegments(snapshot.health);
  $: modelReadinessSegments = buildModelReadinessSegments(runtimeSummary);
  $: freePlanSegments = buildFreePlanSegments(runtimeSummary);
  $: accountTrendPoints = buildMetricTrendPoints(snapshotHistory, "accountCount");
  $: healthTrendPoints = buildMetricTrendPoints(snapshotHistory, "healthScore");
  $: modelTrendPoints = buildMetricTrendPoints(snapshotHistory, "preferredReadyAccountCount");
  $: freeTrendPoints = buildMetricTrendPoints(snapshotHistory, "autoDisabledFreeAccountCount");
  $: primarySampleCount = accounts.filter((account: Account) => getRemainingPercent(account, "primary") !== null).length;
  $: secondarySampleCount = accounts.filter((account: Account) => getRemainingPercent(account, "secondary") !== null).length;
  $: planItems = buildPlanItems(accounts);
  $: statusItems = buildStatusItems(accounts);
  $: runtimeModelItems = buildRuntimeModelItems(runtimeSummary);
  $: runtimeAutomationItems = buildRuntimeAutomationItems(runtimeSummary);
</script>

<section class="page-grid">
  <MetricCard icon={Users} label="Accounts" value={accounts.length} caption={`${activeAccounts.length} active`} chartSegments={accountPoolSegments} sparklinePoints={accountTrendPoints} sparklineColor="var(--chart-1)" />
  <MetricCard icon={Activity} label="Health" value={snapshot.health === "ok" ? "Live" : "Down"} caption={formatTime(snapshot.updatedAt)} chartSegments={healthSegments} sparklinePoints={healthTrendPoints} sparklineColor="var(--success)" />
  <MetricCard icon={CircleGauge} label="5.5 ready" value={preferredReadyCount} caption={`${limitedAccounts.length} accounts currently limited`} chartSegments={modelReadinessSegments} sparklinePoints={modelTrendPoints} sparklineColor="var(--chart-2)" />
  <MetricCard icon={BadgeHelp} label="Free auto-disabled" value={autoDisabledCount} caption={`${Math.max(accounts.length - secondarySampleCount, 0)} accounts still missing weekly quota samples`} chartSegments={freePlanSegments} sparklinePoints={freeTrendPoints} sparklineColor="var(--chart-3)" />
  <article class="wide-panel chart-section">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Quota</p>
        <h2>Remaining quota mix</h2>
      </div>
      <Layers3 size={20} />
    </div>
    <div class="chart-grid">
      <RingChartCard
        eyebrow="Primary window"
        title="5h remaining mix"
        value={formatPercent(averagePrimaryRemaining)}
        caption={`${primarySampleCount} accounts reporting`}
        segments={primaryUsageSegments}
        emptyLabel="No 5h quota values reported yet."
      />
      <RingChartCard
        eyebrow="Secondary window"
        title="Weekly remaining mix"
        value={formatPercent(averageSecondaryRemaining)}
        caption={`${secondarySampleCount} accounts reporting`}
        segments={secondaryUsageSegments}
        emptyLabel="No weekly quota values reported yet."
      />
    </div>
  </article>
  <InsightPanel eyebrow="Plans" title="Plan coverage" icon={Layers3} items={planItems} emptyLabel="No imported accounts yet." />
  <InsightPanel eyebrow="Pool" title="Status snapshot" icon={CircleGauge} items={statusItems} emptyLabel="No pool state yet." />
  <InsightPanel eyebrow="Models" title="Capability preference" icon={BadgeHelp} items={runtimeModelItems} emptyLabel="Runtime capability summary unavailable." />
  <InsightPanel eyebrow="Automation" title="Policy switches" icon={CheckCircle2} items={runtimeAutomationItems} emptyLabel="Runtime automation summary unavailable." />
  <article class="wide-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Request routing</p>
        <h2>Local proxy endpoints</h2>
      </div>
      <CheckCircle2 size={20} />
    </div>
    <EndpointList targets={proxyTargets} />
  </article>
</section>
