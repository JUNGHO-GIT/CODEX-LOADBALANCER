<script lang="ts">
  
  import { type ClientSnapshot, formatTime, type SnapshotHistoryPoint } from "@assets/scripts/api";
  import {
    buildModelCoverageItems,
    buildPlanItems,
    buildRuntimeSettingsItems,
  } from "@assets/scripts/insights";
  import InsightPanel from "@interfaces/components/InsightPanel.svelte";
import { Layers3, Orbit, Server } from "lucide-svelte";

  export let snapshot: ClientSnapshot;
  export let snapshotHistory: SnapshotHistoryPoint[] = [];
  export let onClearHistory: () => void = () => {};
  export let onClearGlobalCooldown: () => void | Promise<void> = () => {};

  $: planItems = buildPlanItems(snapshot.accounts);
  $: modelCoverageItems = buildModelCoverageItems(snapshot.accounts);
  $: runtimeSettingsItems = buildRuntimeSettingsItems(snapshot.runtimeSummary);
  $: firstHistoryPoint = snapshotHistory.at(0) ?? null;
  $: lastHistoryPoint = snapshotHistory.at(-1) ?? null;
  $: cooldown = snapshot.runtimeSummary?.cooldown ?? null;
  $: cooldownState = cooldown?.active ? `Active · ${cooldown.retryAfterSeconds}s` : "Inactive";
  $: cooldownUntilMs = cooldown?.until === undefined || cooldown.until === null ? null : cooldown.until * 1000;
</script>

<section class="split-panels">
  <article class="wide-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Runtime</p>
        <h2>Backend status</h2>
      </div>
      <Server size={20} />
    </div>
    <dl class="settings-list">
      <div><dt>Health route</dt><dd>/health/live</dd></div>
      <div><dt>Accounts route</dt><dd>/api/accounts</dd></div>
      <div><dt>Runtime summary</dt><dd>/api/runtime-summary</dd></div>
      <div><dt>Cooldown</dt><dd>{cooldownState}</dd></div>
      <div><dt>Cooldown until</dt><dd>{formatTime(cooldownUntilMs)}</dd></div>
      <div>
        <dt>Cooldown clear</dt>
        <dd><button type="button" class="inline-action" on:click={onClearGlobalCooldown}>Clear</button></dd>
      </div>
      <div><dt>Imported accounts</dt><dd>{snapshot.accounts.length}</dd></div>
      <div><dt>Last refresh</dt><dd>{formatTime(snapshot.updatedAt)}</dd></div>
    </dl>
  </article>
  <article class="wide-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Client telemetry</p>
        <h2>Chart history cache</h2>
      </div>
      <Orbit size={20} />
    </div>
    <dl class="settings-list">
      <div><dt>History points</dt><dd>{snapshotHistory.length}</dd></div>
      <div><dt>First point</dt><dd>{formatTime(firstHistoryPoint?.timestamp ?? null)}</dd></div>
      <div><dt>Latest point</dt><dd>{formatTime(lastHistoryPoint?.timestamp ?? null)}</dd></div>
      <div><dt>Storage</dt><dd>localStorage</dd></div>
      <div>
        <dt>History clear</dt>
        <dd><button type="button" class="inline-action" on:click={onClearHistory}>Clear</button></dd>
      </div>
      <div><dt>Auto refresh</dt><dd>30s</dd></div>
    </dl>
  </article>
</section>

<section class="split-panels secondary-grid">
  <InsightPanel eyebrow="Plans" title="Plan metadata coverage" icon={Layers3} items={planItems} emptyLabel="No account plan metadata yet." />
  <InsightPanel eyebrow="Runtime" title="Proxy policy settings" icon={Server} items={runtimeSettingsItems} emptyLabel="Runtime summary unavailable." />
</section>

<section class="split-panels secondary-grid">
  <InsightPanel eyebrow="Capabilities" title="Model learning coverage" icon={Orbit} items={modelCoverageItems} emptyLabel="No capability telemetry yet." />
</section>
