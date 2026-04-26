<script lang="ts">
  export let points: number[] = [];
  export let color = "var(--chart-1)";
  export let height = 42;

  $: values = points.filter((point) => Number.isFinite(point));
  $: hasData = values.length > 1;
  $: linePoints = hasData ? buildLinePoints(values, 100, height) : "";
  $: areaPoints = hasData ? `0,${height} ${linePoints} 100,${height}` : "";

  // 1. Line points build ―――――――――――――――――――――――――――――――――――――――――――――――――――――
  function buildLinePoints(entries: number[], width: number, chartHeight: number): string {
    const min = Math.min(...entries);
    const max = Math.max(...entries);
    const range = Math.max(1, max - min);
    return entries
      .map((entry, index) => {
        const x = entries.length === 1 ? width : (index / (entries.length - 1)) * width;
        const y = chartHeight - ((entry - min) / range) * (chartHeight - 4) - 2;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }
</script>

{#if hasData}
  <svg class="sparkline-chart" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
    <polygon points={areaPoints} fill={color} opacity="0.12"></polygon>
    <polyline points={linePoints} fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
  </svg>
{/if}
