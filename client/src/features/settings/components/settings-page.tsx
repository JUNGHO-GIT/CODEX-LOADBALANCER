import { MoonStar, ShieldCheck, SunMedium } from "lucide-react";
import { AlertMessage } from "@/components/alert-message";
import { useClearGlobalCooldown, useLoadBalancerSnapshot, useSnapshotHistory } from "@/features/dashboard/hooks/use-dashboard";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { useThemeStore, type ThemePreference } from "@/hooks/use-theme";
import { useTimeFormatStore, type TimeFormatPreference } from "@/hooks/use-time-format";
import { formatDateTimeInline, formatRelativeFromSeconds } from "@/utils/formatters";
import { cn } from "@/lib/utils";

const themeOptions: ThemePreference[] = ["light", "dark", "auto"];
const timeFormatOptions: TimeFormatPreference[] = ["12h", "24h"];

// 1. Choice button group ――――――――――――――――――――――――――――――――――――――――――――――――――――――
function ChoiceButtonGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          type="button"
          key={option}
          className={cn(
            "press-scale rounded-full border px-3 py-2 text-sm font-medium transition-colors",
            value === option
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/60 bg-card text-muted-foreground hover:text-foreground",
          )}
          onClick={() => {
            onChange(option);
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

// 2. Settings page ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function SettingsPage() {
  const snapshotQuery = useLoadBalancerSnapshot();
  const { history, clearHistory } = useSnapshotHistory(snapshotQuery.data);
  const clearCooldownMutation = useClearGlobalCooldown();
  const theme = useThemeStore((state) => state.preference);
  const setTheme = useThemeStore((state) => state.setTheme);
  const blurred = usePrivacyStore((state) => state.blurred);
  const togglePrivacy = usePrivacyStore((state) => state.toggle);
  const timeFormat = useTimeFormatStore((state) => state.timeFormat);
  const setTimeFormat = useTimeFormatStore((state) => state.setTimeFormat);
  const runtimeSummary = snapshotQuery.data?.runtimeSummary ?? null;

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Local preferences and runtime controls aligned to current backend surface.</p>
      </div>

      {snapshotQuery.error instanceof Error ? (
        <AlertMessage variant="error">{snapshotQuery.error.message}</AlertMessage>
      ) : null}

      {clearCooldownMutation.error instanceof Error ? (
        <AlertMessage variant="error">{clearCooldownMutation.error.message}</AlertMessage>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Appearance</p>
            <h2 className="mt-1 text-base font-semibold">Client preferences</h2>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <SunMedium className="h-4 w-4 text-muted-foreground" />
              Theme
            </div>
            <ChoiceButtonGroup options={themeOptions} value={theme} onChange={setTheme} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MoonStar className="h-4 w-4 text-muted-foreground" />
              Time format
            </div>
            <ChoiceButtonGroup options={timeFormatOptions} value={timeFormat} onChange={setTimeFormat} />
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Privacy blur</p>
                <p className="mt-1 text-xs text-muted-foreground">Mask account emails across dashboard cards and lists.</p>
              </div>
              <button
                type="button"
                className={cn(
                  "press-scale rounded-full px-3 py-2 text-sm font-medium",
                  blurred
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/60 bg-card text-muted-foreground",
                )}
                onClick={togglePrivacy}
              >
                {blurred ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Runtime</p>
            <h2 className="mt-1 text-base font-semibold">Live runtime summary</h2>
          </div>

          {runtimeSummary === null ? (
            <p className="text-sm text-muted-foreground">Runtime summary unavailable.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Preferred model</p>
                <p className="mt-2 text-sm font-semibold">{runtimeSummary.settings.preferredHighCapabilityModel}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Fallback model</p>
                <p className="mt-2 text-sm font-semibold">{runtimeSummary.settings.fallbackHighCapabilityModel}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Request budget</p>
                <p className="mt-2 text-sm font-semibold">{runtimeSummary.settings.proxyRequestBudgetSeconds}s</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Max body bytes</p>
                <p className="mt-2 text-sm font-semibold">{runtimeSummary.settings.proxyMaxBodyBytes.toLocaleString("en-US")}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Usage poll</p>
                <p className="mt-2 text-sm font-semibold">{runtimeSummary.settings.usagePollIntervalSeconds}s / {runtimeSummary.settings.usagePollConcurrency} workers</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Global cooldown</p>
                <p className="mt-2 text-sm font-semibold">{runtimeSummary.cooldown.active ? "Active" : "Inactive"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {runtimeSummary.cooldown.retryAfterSeconds === null ? "No retry-after" : formatRelativeFromSeconds(runtimeSummary.cooldown.retryAfterSeconds)}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Snapshot cache</p>
            <h2 className="mt-1 text-base font-semibold">Local history persistence</h2>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
            <p className="text-sm font-medium">Stored points</p>
            <p className="mt-2 text-2xl font-semibold">{history.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {history.at(-1) ? `Last point ${formatDateTimeInline(history.at(-1)?.sourceUpdatedAt ?? null)}` : "No cached points yet"}
            </p>
          </div>
          <button
            type="button"
            className="press-scale inline-flex h-10 items-center justify-center rounded-full border border-border/60 px-4 text-sm font-medium"
            onClick={clearHistory}
          >
            Clear history
          </button>
        </section>

        <section className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Guard rails</p>
            <h2 className="mt-1 text-base font-semibold">Cooldown control</h2>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
            <p className="text-sm font-medium">Cooldown state</p>
            <p className="mt-2 text-2xl font-semibold">{runtimeSummary?.cooldown.active ? "Active" : "Inactive"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Until {formatDateTimeInline(runtimeSummary?.cooldown.until === null || runtimeSummary?.cooldown.until === undefined ? null : runtimeSummary.cooldown.until * 1000)}
            </p>
          </div>
          <button
            type="button"
            className="press-scale inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
            disabled={clearCooldownMutation.isPending}
            onClick={() => {
              void clearCooldownMutation.mutateAsync();
            }}
          >
            {clearCooldownMutation.isPending ? "Clearing..." : "Clear global cooldown"}
          </button>
        </section>
      </div>
    </div>
  );
}
