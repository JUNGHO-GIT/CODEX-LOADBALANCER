<script lang="ts">
  
  import type { InsightItem } from "@assets/scripts/insights";
import type { Icon } from "lucide-svelte";

  export let eyebrow: string;
  export let title: string;
  export let icon: typeof Icon;
  export let items: InsightItem[] = [];
  export let emptyLabel = "No data yet.";
</script>

<article class="wide-panel insight-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
    </div>
    <svelte:component this={icon} size={20} />
  </div>

  {#if items.length > 0}
    <div class="insight-list">
      {#each items as item}
        <div class="insight-row">
          <div class="insight-copy">
            <strong>{item.label}</strong>
            <small>{item.caption}</small>
          </div>
          <span class={`insight-value ${item.tone}`}>{item.value}</span>
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty-state">{emptyLabel}</div>
  {/if}
</article>
