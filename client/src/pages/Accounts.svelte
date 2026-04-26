<script lang="ts">
import type { Account, ClientSnapshot } from "@assets/scripts/api";
  import AccountInspector from "@interfaces/components/AccountInspector.svelte";
  import AccountTable from "@interfaces/components/AccountTable.svelte";

  export let snapshot: ClientSnapshot;

  let selectedAccountId: string | null = null;

  $: if (snapshot.accounts.length === 0) {
    selectedAccountId = null;
  } else if (!selectedAccountId || !snapshot.accounts.some((account) => account.id === selectedAccountId)) {
    selectedAccountId = snapshot.accounts[0].id;
  }

  $: selectedAccount = snapshot.accounts.find((account) => account.id === selectedAccountId) ?? null;

  // 1. Account select ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
  function selectAccount(account: Account): void {
    selectedAccountId = account.id;
  }
</script>

<section class="accounts-layout">
  <section class="table-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Pool</p>
        <h2>Imported accounts</h2>
      </div>
      <span class="count-badge">{snapshot.accounts.length}</span>
    </div>
    <AccountTable accounts={snapshot.accounts} {selectedAccountId} onSelect={selectAccount} />
  </section>
  <AccountInspector account={selectedAccount} />
</section>
