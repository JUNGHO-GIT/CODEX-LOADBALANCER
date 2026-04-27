import { Activity, Gauge, Tag } from "lucide-react";
import { useLoadBalancerSnapshot } from "@/features/dashboard/hooks/use-dashboard";
import { formatTimeLong } from "@/utils/formatters";

// 1. Status bar ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function StatusBar() {
  const snapshotQuery = useLoadBalancerSnapshot();
  const snapshot = snapshotQuery.data;
  const lastSync = formatTimeLong(snapshot?.updatedAt);
  const isLive = snapshot?.health === "ok";
  const preferredModel = snapshot?.runtimeSummary?.settings.preferredHighCapabilityModel ?? "--";
  const fallbackModel = snapshot?.runtimeSummary?.settings.fallbackHighCapabilityModel ?? "--";

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/[0.08] bg-background/70 px-4 py-2 shadow-[0_-1px_12px_rgba(0,0,0,0.06)] backdrop-blur-xl backdrop-saturate-[1.8]">
      <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {isLive ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : <Activity className="h-3 w-3" />}
          <span className="font-medium">Last sync:</span> {lastSync.time}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Gauge className="h-3 w-3" />
          <span className="font-medium">Models:</span> {preferredModel} / {fallbackModel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Tag className="h-3 w-3" />
          <span className="font-medium">Version:</span> {__APP_VERSION__}
        </span>
      </div>
    </footer>
  );
}
