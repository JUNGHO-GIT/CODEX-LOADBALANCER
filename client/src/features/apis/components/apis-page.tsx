import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertMessage } from "@/components/alert-message";
import { useLoadBalancerSnapshot } from "@/features/dashboard/hooks/use-dashboard";
import { formatCompactNumber } from "@/utils/formatters";
import { Router } from "lucide-react";

type ApiSurface = {
  id: string;
  title: string;
  path: string;
  description: string;
  method: string;
  notes: string[];
  sample: string;
};

// 1. API surface build ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function buildApiSurfaces(origin: string, snapshotBodyBytes: number | null, requestBudgetSeconds: number | null): ApiSurface[] {
  return [
    {
      id: "codex",
      title: "Codex backend",
      path: "/backend-api/codex",
      method: "POST",
      description: "Transparent upstream bridge for Codex-style routes.",
      notes: [
        `Max body bytes: ${snapshotBodyBytes === null ? "--" : formatCompactNumber(snapshotBodyBytes)}`,
        `Request budget: ${requestBudgetSeconds === null ? "--" : `${requestBudgetSeconds}s`}`,
      ],
      sample: `curl -X POST ${origin}/backend-api/codex/responses -H "Content-Type: application/json" -d "{\\"model\\":\\"gpt-5.4\\",\\"input\\":\\"ping\\"}"`,
    },
    {
      id: "openai",
      title: "OpenAI compatible",
      path: "/v1",
      method: "POST",
      description: "Local OpenAI-compatible proxy surface.",
      notes: [
        "Supports `/v1/models` and proxied request families.",
        "Uses same account pool and cooldown rules as Codex route.",
      ],
      sample: `curl ${origin}/v1/models`,
    },
    {
      id: "health",
      title: "Health probe",
      path: "/health/live",
      method: "GET",
      description: "Lightweight live endpoint for client/server readiness.",
      notes: [
        "Used by dashboard auto-refresh.",
        "Returns `{ status: \"ok\" }` when service is live.",
      ],
      sample: `curl ${origin}/health/live`,
    },
    {
      id: "accounts",
      title: "Accounts API",
      path: "/api/accounts",
      method: "GET / POST",
      description: "Lists imported accounts and accepts direct token imports.",
      notes: [
        "POST requires `accessToken`, `refreshToken`, and `idToken`.",
        "Response redacts encrypted token bodies.",
      ],
      sample: `curl ${origin}/api/accounts`,
    },
    {
      id: "runtime",
      title: "Runtime summary",
      path: "/api/runtime-summary",
      method: "GET",
      description: "Runtime policy, counts, model readiness, and cooldown summary.",
      notes: [
        "Primary client observability endpoint.",
        "Powers dashboard, settings, and status bar.",
      ],
      sample: `curl ${origin}/api/runtime-summary`,
    },
  ];
}

// 2. APIs page ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function ApisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const snapshotQuery = useLoadBalancerSnapshot();
  const origin = typeof window === "undefined" ? "http://127.0.0.1:58557" : window.location.origin;
  const surfaces = useMemo(() => buildApiSurfaces(
    origin,
    snapshotQuery.data?.runtimeSummary?.settings.proxyMaxBodyBytes ?? null,
    snapshotQuery.data?.runtimeSummary?.settings.proxyRequestBudgetSeconds ?? null,
  ), [origin, snapshotQuery.data?.runtimeSummary?.settings.proxyMaxBodyBytes, snapshotQuery.data?.runtimeSummary?.settings.proxyRequestBudgetSeconds]);
  const selectedId = searchParams.get("selected");
  const selected = useMemo(() => {
    if (selectedId) {
      return surfaces.find((surface) => surface.id === selectedId) ?? surfaces[0];
    }
    return surfaces[0];
  }, [selectedId, surfaces]);

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">APIs</h1>
        <p className="mt-1 text-sm text-muted-foreground">Reference route explorer adapted to local proxy/admin surfaces.</p>
      </div>

      {snapshotQuery.error instanceof Error ? (
        <AlertMessage variant="error">{snapshotQuery.error.message}</AlertMessage>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="rounded-xl border bg-card p-4">
          <div className="space-y-2">
            {surfaces.map((surface) => (
              <button
                type="button"
                key={surface.id}
                className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-3 text-left transition-colors ${
                  selected.id === surface.id
                    ? "border-primary/40 bg-primary/8"
                    : "border-transparent bg-muted/20 hover:border-border/70 hover:bg-muted/40"
                }`}
                onClick={() => {
                  const nextSearchParams = new URLSearchParams(searchParams);
                  nextSearchParams.set("selected", surface.id);
                  setSearchParams(nextSearchParams);
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{surface.title}</span>
                  <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">{surface.method}</span>
                </div>
                <code className="font-mono text-[11px] text-muted-foreground">{surface.path}</code>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Selected surface</p>
              <h2 className="mt-1 text-base font-semibold">{selected.title}</h2>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
              <Router className="h-4 w-4" />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{selected.description}</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Method</p>
              <p className="mt-2 text-sm font-semibold">{selected.method}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Path</p>
              <code className="mt-2 block font-mono text-xs">{selected.path}</code>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Example</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-foreground">{selected.sample}</pre>
          </div>

          <div className="mt-4 space-y-2">
            {selected.notes.map((note) => (
              <div key={note} className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                {note}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
