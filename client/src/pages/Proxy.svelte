<script lang="ts">
  
  import type { ClientSnapshot } from "@assets/scripts/api";
  import {
    buildModelCoverageItems,
    buildRuntimeAutomationItems,
    buildRuntimeModelItems,
    buildStatusItems,
    type InsightItem,
  } from "@assets/scripts/insights";
  import EndpointList from "@interfaces/components/EndpointList.svelte";
  import InsightPanel from "@interfaces/components/InsightPanel.svelte";
  import { proxyTargets } from "@stores/client";
import { GitBranch, KeyRound, Orbit, Router } from "lucide-svelte";

  export let snapshot: ClientSnapshot;

  const routingItems: InsightItem[] = [
    {
      label: "Primary account",
      value: "first",
      caption: "The balancer starts with the top ranked active account.",
      tone: "primary",
    },
    {
      label: "Rate limit fallback",
      value: "parallel",
      caption: "Remaining candidates race when the primary account gets limited.",
      tone: "warning",
    },
    {
      label: "401 recovery",
      value: "1 retry",
      caption: "Each account refreshes its token once before the request fails.",
      tone: "success",
    },
  ];

  $: modelCoverageItems = buildModelCoverageItems(snapshot.accounts);
  $: statusItems = buildStatusItems(snapshot.accounts);
  $: runtimeModelItems = buildRuntimeModelItems(snapshot.runtimeSummary);
  $: runtimeAutomationItems = buildRuntimeAutomationItems(snapshot.runtimeSummary);
</script>

<section class="split-panels">
  <article class="wide-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Routes</p>
        <h2>Client endpoints</h2>
      </div>
      <Router size={20} />
    </div>
    <EndpointList targets={proxyTargets} />
  </article>
  <article class="wide-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Auth</p>
        <h2>Bearer gate</h2>
      </div>
      <KeyRound size={20} />
    </div>
    <p class="panel-copy">Proxy API key auth follows `CODEX_LB_API_KEY_AUTH_ENABLED`. When enabled, clients send `Authorization: Bearer sk-clb-...`.</p>
  </article>
</section>

<section class="split-panels secondary-grid">
  <InsightPanel eyebrow="Flow" title="Routing behavior" icon={GitBranch} items={routingItems} emptyLabel="No route rules configured." />
  <InsightPanel eyebrow="Coverage" title="Model readiness" icon={Orbit} items={modelCoverageItems} emptyLabel="No capability telemetry yet." />
</section>

<section class="split-panels secondary-grid">
  <InsightPanel eyebrow="Preference" title="Preferred model policy" icon={Orbit} items={runtimeModelItems} emptyLabel="Runtime capability summary unavailable." />
  <InsightPanel eyebrow="Automation" title="Fallback and disable rules" icon={GitBranch} items={runtimeAutomationItems} emptyLabel="Runtime automation summary unavailable." />
</section>

<section class="split-panels secondary-grid">
  <InsightPanel eyebrow="Pool" title="Fallback-ready states" icon={Router} items={statusItems} emptyLabel="No pool state yet." />
</section>
