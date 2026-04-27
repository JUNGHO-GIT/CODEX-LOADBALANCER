import { useMemo } from "react";
import { DonutChart } from "@/components/donut-chart";
import type { RemainingItem } from "@/features/dashboard/utils";

export type UsageDonutsProps = {
  primaryItems: RemainingItem[];
  secondaryItems: RemainingItem[];
  primaryTotal: number;
  secondaryTotal: number;
};

// 1. Usage donuts ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function UsageDonuts({
  primaryItems,
  secondaryItems,
  primaryTotal,
  secondaryTotal,
}: UsageDonutsProps) {
  const primaryChartItems = useMemo(() => primaryItems.map((item) => ({
    id: item.accountId,
    label: item.label,
    labelSuffix: item.labelSuffix,
    isEmail: item.isEmail,
    value: item.value,
    color: item.color,
  })), [primaryItems]);
  const secondaryChartItems = useMemo(() => secondaryItems.map((item) => ({
    id: item.accountId,
    label: item.label,
    labelSuffix: item.labelSuffix,
    isEmail: item.isEmail,
    value: item.value,
    color: item.color,
  })), [secondaryItems]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <DonutChart
        title="5h remaining"
        subtitle="Primary quota mix by account"
        items={primaryChartItems}
        total={primaryTotal}
        centerValue={primaryTotal}
      />
      <DonutChart
        title="Weekly remaining"
        subtitle="Secondary quota mix by account"
        items={secondaryChartItems}
        total={secondaryTotal}
        centerValue={secondaryTotal}
      />
    </div>
  );
}
