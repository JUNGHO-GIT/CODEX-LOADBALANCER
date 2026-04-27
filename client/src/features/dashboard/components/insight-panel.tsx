import type { LucideIcon } from "lucide-react";
import type { InsightItem } from "@/features/dashboard/utils";
import { getToneClass } from "@/features/dashboard/utils";

export type InsightPanelProps = {
  eyebrow: string;
  title: string;
  icon: LucideIcon;
  items: InsightItem[];
  emptyLabel: string;
};

// 1. Insight panel ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function InsightPanel({ eyebrow, title, icon: Icon, items, emptyLabel }: InsightPanelProps) {
  return (
    <article className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
          <h2 className="mt-1 text-base font-semibold">{title}</h2>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.label} className="rounded-lg border border-border/60 bg-muted/25 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{item.label}</span>
                <span className={`text-sm font-semibold ${getToneClass(item.tone)}`}>{item.value}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.caption}</p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
