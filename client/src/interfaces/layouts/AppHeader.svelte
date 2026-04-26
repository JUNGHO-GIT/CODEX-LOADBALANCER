<script lang="ts">
  import { RefreshCw, Shield } from "lucide-svelte";

  export let health: "ok" | "down";
  export let loading: boolean;
  export let onRefresh: () => void;
</script>

<header class="app-header">
  <div class="brand-lockup">
    <div class="brand-mark" aria-hidden="true">
      <Shield size={20} />
    </div>
    <div>
      <p class="eyebrow">CODEX LoadBalancer</p>
      <h1>Client control plane</h1>
    </div>
  </div>
  <div class="header-actions">
    <div class:online={health === "ok"} class="health-pill">
      <span></span>
      {health === "ok" ? "Backend online" : "Backend down"}
    </div>
    <button class="icon-button" type="button" on:click={onRefresh} aria-label="Refresh client data">
      <RefreshCw size={18} class={loading ? "spinning" : ""} />
    </button>
  </div>
</header>
