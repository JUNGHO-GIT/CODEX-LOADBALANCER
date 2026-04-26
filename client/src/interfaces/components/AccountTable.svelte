<script lang="ts">
  import { type Account, formatTime } from "@assets/scripts/api";
  import {
    formatPlanLabel,
    formatStatusLabel,
    getAccountModelStrategy,
    getRemainingPercent,
  } from "@assets/scripts/insights";

  export let accounts: Account[];
  export let selectedAccountId: string | null = null;
  export let onSelect: (account: Account) => void = () => undefined;
</script>

<div class="account-table">
  <div class="table-head">
    <span>Account</span>
    <span>Status</span>
    <span>Model</span>
    <span>Remaining</span>
    <span>Refresh</span>
  </div>
  {#each accounts as account}
    <button
      class:selected={selectedAccountId === account.id}
      class="table-row"
      type="button"
      on:click={() => onSelect(account)}
    >
      <div>
        <strong>{account.email ?? account.id}</strong>
        <small>{formatPlanLabel(account.planType)}</small>
      </div>
      <span class={`status-chip ${account.status}`}>{formatStatusLabel(account.status)}</span>
      <span class={`inline-pill ${getAccountModelStrategy(account).tone}`}>{getAccountModelStrategy(account).label}</span>
      <span>
        {#if getRemainingPercent(account, "primary") !== null}
          {getRemainingPercent(account, "primary")}%
        {:else}
          --
        {/if}
        {" / "}
        {#if getRemainingPercent(account, "secondary") !== null}
          {getRemainingPercent(account, "secondary")}%
        {:else}
          --
        {/if}
      </span>
      <span>{formatTime(account.lastRefresh)}</span>
    </button>
  {:else}
    <div class="empty-state">No imported accounts yet.</div>
  {/each}
</div>
