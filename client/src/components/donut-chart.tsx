import { useEffect, useRef, useState } from "react";
import { Cell, Pie, PieChart, Sector, type PieSectorShapeProps } from "recharts";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useThemeStore } from "@/hooks/use-theme";
import { buildDonutPalette } from "@/utils/colors";
import { formatCompactNumber } from "@/utils/formatters";

export type DonutChartItem = {
  id?: string;
  label: string;
  labelSuffix?: string;
  isEmail?: boolean;
  value: number;
  color?: string;
};

export type DonutChartProps = {
  items: DonutChartItem[];
  total: number;
  centerValue?: number;
  title: string;
  subtitle?: string;
};

type DonutDatum = {
  id: string;
  name: string;
  value: number;
  fill: string;
};

const CHART_SIZE = 152;
const CHART_MARGIN = 4;
const PIE_CX = 72;
const PIE_CY = 72;
const INNER_R = 53;
const OUTER_R = 68;
const ACTIVE_RADIUS_OFFSET = 4;

// 1. Used percent format ―――――――――――――――――――――――――――――――――――――――――――――――――――――
function formatUsedPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) {
    return "0%";
  }
  return `${percent.toLocaleString("en-US", { maximumFractionDigits: percent < 10 ? 1 : 0 })}%`;
}

// 2. Donut chart ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function DonutChart({ items, total, centerValue, title, subtitle }: DonutChartProps) {
  const isDark = useThemeStore((state) => state.theme === "dark");
  const blurred = usePrivacyStore((state) => state.blurred);
  const reducedMotion = useReducedMotion();
  const [activeLegendId, setActiveLegendId] = useState<string | null>(null);
  const legendRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const consumedColor = isDark ? "#404040" : "#d3d3d3";
  const palette = buildDonutPalette(items.length, isDark);
  const normalizedItems = items.map((item, index) => ({
    ...item,
    color: item.color ?? palette[index % palette.length],
  }));
  const remainingTotal = normalizedItems.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const safeCapacity = Math.max(0, total);
  const consumed = Math.max(0, total - remainingTotal);
  const displayTotal = Math.max(0, centerValue ?? total);
  const usedPercent = safeCapacity > 0 ? (consumed / safeCapacity) * 100 : 0;

  const chartData: DonutDatum[] = [
    ...normalizedItems.map((item) => ({
      id: item.id ?? item.label,
      name: item.label,
      value: Math.max(0, item.value),
      fill: item.color,
    })),
    ...(consumed > 0 ? [{ id: "__consumed__", name: "__consumed__", value: consumed, fill: consumedColor }] : []),
  ];

  if (!chartData.some((item) => item.value > 0)) {
    chartData.length = 0;
    chartData.push({ id: "__empty__", name: "__empty__", value: 1, fill: consumedColor });
  }

  useEffect(() => {
    if (activeLegendId !== null) {
      legendRefs.current[activeLegendId]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeLegendId]);

  const renderDonutShape = (props: PieSectorShapeProps) => {
    const isHighlighted = props.isActive || (props.payload as DonutDatum | undefined)?.id === activeLegendId;
    const outerRadius = typeof props.outerRadius === "number"
      ? props.outerRadius + (isHighlighted ? ACTIVE_RADIUS_OFFSET : 0)
      : OUTER_R + (isHighlighted ? ACTIVE_RADIUS_OFFSET : 0);

    return (
      <Sector
        {...props}
        outerRadius={outerRadius}
        stroke={isHighlighted ? "hsl(var(--background))" : "none"}
        strokeWidth={isHighlighted ? 2 : 0}
      />
    );
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-6">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="relative h-[152px] w-[152px] overflow-visible">
            <PieChart width={CHART_SIZE} height={CHART_SIZE} margin={{ top: CHART_MARGIN, right: CHART_MARGIN, bottom: CHART_MARGIN, left: CHART_MARGIN }}>
              <Pie
                data={chartData}
                cx={PIE_CX}
                cy={PIE_CY}
                innerRadius={INNER_R}
                outerRadius={OUTER_R}
                startAngle={90}
                endAngle={-270}
                dataKey="value"
                stroke="none"
                shape={renderDonutShape}
                isAnimationActive={!reducedMotion}
                animationDuration={600}
                animationEasing="ease-out"
                onMouseEnter={(data) => {
                  const payload = data as { id?: unknown } | undefined;
                  if (typeof payload?.id === "string") {
                    setActiveLegendId(payload.id);
                  }
                }}
                onMouseLeave={() => {
                  setActiveLegendId(null);
                }}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.id} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
            <div className="pointer-events-none absolute inset-[22px] flex items-center justify-center rounded-full text-center">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Remaining</p>
                <p className="text-base font-semibold tabular-nums">{formatCompactNumber(displayTotal)}</p>
              </div>
            </div>
          </div>
          <p className="text-[11px] tabular-nums text-muted-foreground">
            Total {formatCompactNumber(safeCapacity)} · {formatUsedPercent(usedPercent)} used
          </p>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto pr-1">
          {normalizedItems.map((item, index) => {
            const legendId = item.id ?? item.label;
            const isActive = activeLegendId === legendId;
            return (
              <button
                ref={(node) => {
                  legendRefs.current[legendId] = node;
                }}
                type="button"
                key={legendId}
                className="flex h-8 w-full items-center justify-between gap-3 rounded-lg border px-2 text-xs transition-all"
                style={{
                  animationDelay: `${index * 75}ms`,
                  borderColor: isActive ? item.color : "transparent",
                }}
                onMouseEnter={() => {
                  setActiveLegendId(legendId);
                }}
                onMouseLeave={() => {
                  setActiveLegendId(null);
                }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate font-medium">
                    {item.isEmail && blurred
                      ? <><span className="privacy-blur">{item.label}</span>{item.labelSuffix}</>
                      : <>{item.label}{item.labelSuffix}</>}
                  </span>
                </div>
                <span className="tabular-nums text-muted-foreground">{formatCompactNumber(item.value)}</span>
              </button>
            );
          })}
          <button
            ref={(node) => {
              legendRefs.current.__consumed__ = node;
            }}
            type="button"
            className="flex h-8 w-full items-center justify-between gap-3 rounded-lg border px-2 text-xs transition-all"
            style={{ borderColor: activeLegendId === "__consumed__" ? consumedColor : "transparent" }}
            onMouseEnter={() => {
              setActiveLegendId("__consumed__");
            }}
            onMouseLeave={() => {
              setActiveLegendId(null);
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: consumedColor }} />
              <span className="truncate font-medium">Used</span>
            </div>
            <span className="tabular-nums text-muted-foreground">{formatCompactNumber(consumed)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
