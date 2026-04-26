<script lang="ts">
  import type { ProxyTarget } from "@stores/client";

  export let targets: ProxyTarget[];
</script>

<div class="endpoint-list">
  {#each targets as target}
    <div class="endpoint-row">
      <span>{target.label}</span>
      <code>{target.endpoint}</code>
    </div>
  {/each}
</div>
