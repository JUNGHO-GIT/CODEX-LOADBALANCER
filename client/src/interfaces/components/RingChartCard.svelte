<script lang="ts">
  import type { RingSegment } from "@assets/scripts/insights";

  export let eyebrow: string;
  export let title: string;
  export let value: string;
  export let caption: string;
  export let segments: RingSegment[] = [];
  export let emptyLabel = "No chart data yet.";

  $: total = segments.reduce((sum, segment) => sum + segment.value, 0);
  $: gradient = total > 0
    ? buildGradient(segments, total)
    : "conic-gradient(var(--surface-muted) 0deg, var(--surface-muted) 360deg)";

  // 1. Gradient build ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
  function buildGradient(entries: RingSegment[], chartTotal: number): string {
    let offset = 0;
    const stops = entries.map((entry) => {
      const start = offset;
      const sweep = (entry.value / chartTotal) * 360;
      offset += sweep;
      return `${entry.color} ${start}deg ${offset}deg`;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }
</script>

<article class="chart-card">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
    </div>
  </div>

  <div class="ring-layout">
    <div class="ring-shell">
      <div class="ring-chart" style={`background:${gradient}`}></div>
      <div class="ring-core">
        <strong>{value}</strong>
        <span>{caption}</span>
      </div>
    </div>

    {#if segments.length > 0}
      <div class="ring-legend">
        {#each segments as segment}
          <div class="legend-row">
            <span class="legend-dot" style={`background:${segment.color}`}></span>
            <div class="legend-copy">
              <strong>{segment.label}</strong>
              <small>{segment.meta}</small>
            </div>
            <span class="legend-value">{segment.value}%</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state">{emptyLabel}</div>
    {/if}
  </div>
</article>
