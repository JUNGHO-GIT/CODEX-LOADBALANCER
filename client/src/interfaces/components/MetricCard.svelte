<script lang="ts">
  import type { MetricChartSegment } from "@assets/scripts/insights";
  import SparklineChart from "@interfaces/components/SparklineChart.svelte";
  import type { Icon } from "lucide-svelte";

  export let icon: typeof Icon;
  export let label: string;
  export let value: string | number;
  export let caption: string;
  export let chartSegments: MetricChartSegment[] = [];
  export let sparklinePoints: number[] = [];
  export let sparklineColor = "var(--chart-1)";

  $: chartTotal = chartSegments.reduce((sum, segment) => sum + segment.value, 0);
</script>

<article class="metric-card">
  <div class="metric-icon">
    <svelte:component this={icon} size={20} />
  </div>
  <p>{label}</p>
  <strong>{value}</strong>
  <span>{caption}</span>
  {#if chartTotal > 0}
    <div class="metric-chart" aria-label={`${label} distribution chart`}>
      {#each chartSegments as segment}
        <span
          style={`width:${Math.max((segment.value / chartTotal) * 100, 5)}%;background:${segment.color}`}
          title={`${segment.label}: ${segment.meta}`}
        ></span>
      {/each}
    </div>
    <div class="metric-chart-legend">
      {#each chartSegments.slice(0, 3) as segment}
        <span>
          <i style={`background:${segment.color}`}></i>
          {segment.label}
        </span>
      {/each}
    </div>
  {/if}
  {#if sparklinePoints.length > 1}
    <div class="metric-sparkline">
      <SparklineChart points={sparklinePoints} color={sparklineColor} height={40} />
    </div>
  {/if}
</article>
