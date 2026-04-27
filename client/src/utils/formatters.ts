import { getTimeFormatPreference, type TimeFormatPreference } from "@/hooks/use-time-format";

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatterMap: Record<TimeFormatPreference, Intl.DateTimeFormat> = {
  "12h": new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h12",
  }),
  "24h": new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }),
};

export type FormattedDateTime = {
  time: string;
  date: string;
};

// 1. Number normalize ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// 2. Date parse ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function parseDate(value: Date | number | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// 3. Compact number format ―――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatCompactNumber(value: unknown): string {
  const numeric = toNumber(value);
  return numeric === null ? "--" : compactFormatter.format(numeric);
}

// 4. Percent nullable format ―――――――――――――――――――――――――――――――――――――――――――――――――
export function formatPercentNullable(value: unknown): string {
  const numeric = toNumber(value);
  return numeric === null ? "--" : `${Math.round(numeric)}%`;
}

// 5. Slug format ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatSlug(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  const words = value.split("_");
  words[0] = `${words[0].charAt(0).toUpperCase()}${words[0].slice(1)}`;
  return words.join(" ");
}

// 6. Model label format ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatModelList(models: string[] | null | undefined): string {
  if (!models || models.length === 0) {
    return "Unknown";
  }
  return models.join(", ");
}

// 7. Date time long format ――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatTimeLong(value: Date | number | string | null | undefined): FormattedDateTime {
  const date = parseDate(value);
  if (date === null) {
    return { time: "--", date: "--" };
  }
  const timeFormatter = timeFormatterMap[getTimeFormatPreference()];
  return {
    time: timeFormatter.format(date),
    date: dateFormatter.format(date),
  };
}

// 8. Date inline format ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatDateTimeInline(value: Date | number | string | null | undefined): string {
  const formatted = formatTimeLong(value);
  return formatted.time === "--" ? "--" : `${formatted.time} ${formatted.date}`;
}

// 9. Relative duration format ―――――――――――――――――――――――――――――――――――――――――――――――――
export function formatRelativeFromSeconds(seconds: number | null): string {
  if (seconds === null || seconds <= 0) {
    return "--";
  }
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  }
  if (seconds < 3600) {
    return `${Math.ceil(seconds / 60)}m`;
  }
  if (seconds < 86_400) {
    return `${Math.ceil(seconds / 3600)}h`;
  }
  return `${Math.ceil(seconds / 86_400)}d`;
}

// 10. Reset label format ――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function formatResetLabel(value: number | null): string {
  if (value === null) {
    return "--";
  }
  return formatDateTimeInline(value * 1000);
}
