import { RefreshCw, Router, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { AlertMessage } from "@/components/alert-message";
import { useLoadBalancerSnapshot, useSnapshotHistory } from "@/features/dashboard/hooks/use-dashboard";
import { AccountCards } from "@/features/dashboard/components/account-cards";
import { InsightPanel } from "@/features/dashboard/components/insight-panel";
import { StatsGrid } from "@/features/dashboard/components/stats-grid";
import { UsageDonuts } from "@/features/dashboard/components/usage-donuts";
import { buildDashboardView, getRuntimeShieldLabel, RuntimeShieldIcon } from "@/features/dashboard/utils";
import { useThemeStore } from "@/hooks/use-theme";

// 1. Dashboard loading shell ―――――――――――――――――――――――――――――――――――――――――――――――――――
function DashboardLoading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-36 animate-pulse rounded-xl border bg-card/60" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[22rem] animate-pulse rounded-xl border bg-card/60" />
        <div className="h-[22rem] animate-pulse rounded-xl border bg-card/60" />
      </div>
    </div>
  );
}

// 2. Dashboard page ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function DashboardPage() {
  const snapshotQuery = useLoadBalancerSnapshot();
  const { history } = useSnapshotHistory(snapshotQuery.data);
  const isDark = useThemeStore((state) => state.theme === "dark");
  const view = useMemo(() => snapshotQuery.data ? buildDashboardView(snapshotQuery.data, history, isDark) : null, [history, isDark, snapshotQuery.data]);

  if (snapshotQuery.isPending && snapshotQuery.data === undefined) {
    return <DashboardLoading />;
  }

  if (snapshotQuery.data === undefined || view === null) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Overview, readiness, and routing posture.</p>
        </div>
        <AlertMessage variant="error">
          {snapshotQuery.error instanceof Error ? snapshotQuery.error.message : "Failed to load snapshot"}
        </AlertMessage>
      </div>
    );
  }

  const snapshot = snapshotQuery.data;
  const runtimeLabel = getRuntimeShieldLabel(snapshot.runtimeSummary);

  return (
    <div className="animate-fade-in-up space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Reference-style overview rebuilt against local CODEX LB runtime.</p>
        </div>
        <button
          type="button"
          className="press-scale inline-flex h-9 items-center gap-2 rounded-full border border-border/60 bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => {
            void snapshotQuery.refetch();
          }}
          disabled={snapshotQuery.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5${snapshotQuery.isFetching ? " animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {snapshotQuery.error instanceof Error ? (
        <AlertMessage variant="error">{snapshotQuery.error.message}</AlertMessage>
      ) : null}

      <StatsGrid stats={view.stats} />

      <UsageDonuts
        primaryItems={view.primaryUsageItems}
        secondaryItems={view.secondaryUsageItems}
        primaryTotal={view.primaryTotal}
        secondaryTotal={view.secondaryTotal}
      />

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">Accounts</h2>
          <div className="h-px flex-1 bg-border" />
        </div>
        <AccountCards accounts={snapshot.accounts} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <InsightPanel eyebrow="Plans" title="Plan coverage" icon={ShieldCheck} items={view.planItems} emptyLabel="No imported accounts yet." />
        <InsightPanel eyebrow="Pool" title="Status snapshot" icon={RuntimeShieldIcon} items={view.statusItems} emptyLabel="No pool state yet." />
        <InsightPanel eyebrow="Models" title="Capability preference" icon={ShieldCheck} items={view.runtimeModelItems} emptyLabel="Runtime capability summary unavailable." />
        <InsightPanel eyebrow="Automation" title="Policy switches" icon={ShieldCheck} items={view.runtimeAutomationItems} emptyLabel="Runtime automation summary unavailable." />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <article className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Routing</p>
              <h2 className="mt-1 text-base font-semibold">Local proxy endpoints</h2>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
              <Router className="h-4 w-4" />
            </div>
          </div>
          <div className="space-y-3">
            {[
              { label: "Codex backend", path: "/backend-api/codex" },
              { label: "OpenAI compatible", path: "/v1" },
              { label: "Health probe", path: "/health/live" },
            ].map((item) => (
              <div key={item.path} className="rounded-lg border border-border/60 bg-muted/25 p-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">{item.label}</span>
                  <code className="rounded bg-background px-2 py-1 font-mono text-[11px]">{item.path}</code>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Runtime shield</p>
              <h2 className="mt-1 text-base font-semibold">Current guard state</h2>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
              <RuntimeShieldIcon className="h-4 w-4" />
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
              <p className="text-sm font-medium">{runtimeLabel}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Snapshot history points: {history.length}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
              <p className="text-sm font-medium">Preferred / fallback</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {snapshot.runtimeSummary?.settings.preferredHighCapabilityModel ?? "--"} / {snapshot.runtimeSummary?.settings.fallbackHighCapabilityModel ?? "--"}
              </p>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
