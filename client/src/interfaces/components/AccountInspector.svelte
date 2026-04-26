<script lang="ts">
  
  import { type Account, formatTime } from "@assets/scripts/api";
  import {
    formatAccountLabel,
    formatPlanLabel,
    formatStatusLabel,
    getAccountModelStrategy,
    getRemainingPercent,
  } from "@assets/scripts/insights";
import { Activity, Clock3, Gauge, Orbit, ShieldCheck } from "lucide-svelte";

  export let account: Account | null;

  $: primaryRemaining = account ? getRemainingPercent(account, "primary") : null;
  $: secondaryRemaining = account ? getRemainingPercent(account, "secondary") : null;
  $: supportedModels = account?.supportedModelIds ?? [];
  $: unsupportedModels = account?.unsupportedModelIds ?? [];
  $: modelStrategy = account ? getAccountModelStrategy(account) : null;
</script>

<article class="wide-panel account-inspector">
  {#if account}
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Selected account</p>
        <h2>{formatAccountLabel(account)}</h2>
      </div>
      <span class={`status-chip ${account.status}`}>{formatStatusLabel(account.status)}</span>
    </div>

    <div class="inspector-grid">
      <section class="detail-block">
        <div class="detail-title">
          <ShieldCheck size={16} />
          <span>Identity</span>
        </div>
        <dl class="detail-list">
          <div><dt>Email</dt><dd>{account.email ?? "Not stored"}</dd></div>
          <div><dt>Account ID</dt><dd><code>{account.id}</code></dd></div>
          <div><dt>ChatGPT ID</dt><dd>{account.chatgptAccountId ?? "Unknown"}</dd></div>
          <div><dt>Plan</dt><dd>{formatPlanLabel(account.planType)}</dd></div>
          <div><dt>Model lane</dt><dd>{modelStrategy?.label ?? "Learning"}</dd></div>
        </dl>
        {#if account.deactivationReason}
          <p class="muted-note">Reason: {account.deactivationReason}</p>
        {/if}
      </section>

      <section class="detail-block">
        <div class="detail-title">
          <Gauge size={16} />
          <span>Quota overview</span>
        </div>
        <div class="quota-stack">
          <div class="quota-row">
            <div class="quota-head">
              <span>5h remaining</span>
              <strong>{primaryRemaining === null ? "--" : `${primaryRemaining}%`}</strong>
            </div>
            <div class="progress-track">
              <span class="progress-fill primary" style={`width:${primaryRemaining ?? 0}%`}></span>
            </div>
            <small>{account.resetAt ? `Reset ${formatTime(account.resetAt)}` : "No reset sample yet"}</small>
          </div>

          <div class="quota-row">
            <div class="quota-head">
              <span>Weekly remaining</span>
              <strong>{secondaryRemaining === null ? "--" : `${secondaryRemaining}%`}</strong>
            </div>
            <div class="progress-track">
              <span class="progress-fill secondary" style={`width:${secondaryRemaining ?? 0}%`}></span>
            </div>
            <small>{account.cooldownUntil ? `Cooldown until ${formatTime(account.cooldownUntil)}` : "No cooldown active"}</small>
          </div>
        </div>
      </section>

      <section class="detail-block">
        <div class="detail-title">
          <Orbit size={16} />
          <span>Model coverage</span>
        </div>
        {#if supportedModels.length > 0 || unsupportedModels.length > 0}
          <div class="model-stack">
            <div>
              <p class="mini-label">Supported</p>
              {#if modelStrategy}
                <p class={`mini-pill ${modelStrategy.tone}`}>{modelStrategy.caption}</p>
              {/if}
              <div class="model-chip-row">
                {#if supportedModels.length > 0}
                  {#each supportedModels as model}
                    <span class="model-chip success">{model}</span>
                  {/each}
                {:else}
                  <span class="model-chip neutral">No supported models learned</span>
                {/if}
              </div>
            </div>
            <div>
              <p class="mini-label">Blocked</p>
              <div class="model-chip-row">
                {#if unsupportedModels.length > 0}
                  {#each unsupportedModels as model}
                    <span class="model-chip warning">{model}</span>
                  {/each}
                {:else}
                  <span class="model-chip neutral">No blocked models recorded</span>
                {/if}
              </div>
            </div>
          </div>
        {:else}
          <div class="empty-state">Capability learning has not started for this account yet.</div>
        {/if}
      </section>

      <section class="detail-block">
        <div class="detail-title">
          <Activity size={16} />
          <span>Activity</span>
        </div>
        <dl class="detail-list">
          <div><dt>Last refresh</dt><dd>{formatTime(account.lastRefresh)}</dd></div>
          <div><dt>Last selected</dt><dd>{formatTime(account.lastSelectedAt)}</dd></div>
          <div><dt>Error count</dt><dd>{account.errorCount}</dd></div>
          <div><dt>Last error</dt><dd>{formatTime(account.lastErrorAt)}</dd></div>
        </dl>
      </section>
    </div>
  {:else}
    <div class="empty-state">Select an account to inspect plan, quota, and capability details.</div>
  {/if}
</article>
