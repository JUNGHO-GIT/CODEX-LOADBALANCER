<script lang="ts">
  import type { TabItem, TabKey } from "@stores/client";

  export let selectedTab: TabKey;
  export let tabs: TabItem[];
  export let onSelect: (nextTab: TabKey) => void;
</script>

<nav class="tab-strip" aria-label="Client pages">
  {#each tabs as tab}
    <button class:active={selectedTab === tab.key} type="button" on:click={() => onSelect(tab.key)}>
      <svelte:component this={tab.icon} size={17} />
      <span>{tab.label}</span>
    </button>
  {/each}
</nav>
