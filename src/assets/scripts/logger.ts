export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type Logger = {
  level: LogLevel;
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
  child(context: LogContext): Logger;
};

export type LogContext = Record<string, unknown>;

type LogSink = {
  debug(line: string): void;
  info(line: string): void;
  log(line: string): void;
  warn(line: string): void;
  error(line: string): void;
};

const LOG_CONFIG = {
  debug: {
    label: "DEBUG",
    color: "[38;5;141m",
  },
  info: {
    label: "INFO",
    color: "[38;5;46m",
  },
  warn: {
    label: "WARN",
    color: "[38;5;214m",
  },
  error: {
    label: "ERROR",
    color: "[38;5;196m",
  },
} as const;

const RESET_COLOR = "[0m";
const SEPARATOR_COLOR = "[38;2;255;162;0m";
const SEPARATOR_LINE = "―――――――――――――――――――――――――――――――――――――――――――――";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

// 1. Logger create ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function createLogger(
  level: LogLevel,
  defaultContext: LogContext = {},
  sink: LogSink = console,
): Logger {
  const logger: Logger = {
    level,
    debug: (event: string, context: LogContext = {}) => {
      writeLog("debug", event, level, defaultContext, context, sink);
    },
    info: (event: string, context: LogContext = {}) => {
      writeLog("info", event, level, defaultContext, context, sink);
    },
    warn: (event: string, context: LogContext = {}) => {
      writeLog("warn", event, level, defaultContext, context, sink);
    },
    error: (event: string, context: LogContext = {}) => {
      writeLog("error", event, level, defaultContext, context, sink);
    },
    child: (context: LogContext) =>
      createLogger(level, { ...defaultContext, ...context }, sink),
  };
  return logger;
}

// 2. Level parse ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function parseLogLevel(
  value: string | null,
  fallback: LogLevel,
): LogLevel {
  const normalized = value?.trim().toLowerCase();
  const parsed =
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error" ||
    normalized === "silent"
      ? normalized
      : fallback;
  return parsed;
}

// 3. Error context ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function errorContext(error: unknown): LogContext {
  const context =
    error instanceof Error
      ? {
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack,
        }
      : {
          errorMessage: `${error}`,
        };
  return context;
}

// 4. Log write ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function writeLog(
  level: Exclude<LogLevel, "silent">,
  event: string,
  minimumLevel: LogLevel,
  defaultContext: LogContext,
  context: LogContext,
  sink: LogSink,
): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel]) {
    return;
  }
  const cfg = LOG_CONFIG[level];
  const separator = `${SEPARATOR_COLOR}${SEPARATOR_LINE}${RESET_COLOR}`;
  const header = `${cfg.color}[${cfg.label} - ${event}]${RESET_COLOR}`;
  const mergedContext = {
    time: new Date().toISOString(),
    ...sanitizeContext(defaultContext),
    ...sanitizeContext(context),
  };
  const line = `${separator}\n${header}\n${formatContext(mergedContext, cfg.color)}`;
  if (level === "debug") {
    sink.debug(line);
  } else if (level === "info") {
    sink.info(line);
  } else if (level === "warn") {
    sink.warn(line);
  } else {
    sink.error(line);
  }
}

// 5. Context format ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function formatContext(context: LogContext, keyColor: string): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    if (value === null || value === undefined) {
      continue;
    }
    const labeled = `${keyColor}- ${titleCaseKey(key)} :${RESET_COLOR}`;
    lines.push(`${labeled} ${formatValue(value)}`);
  }
  return lines.join("\n");
}

// 6. Key title-case ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function titleCaseKey(key: string): string {
  if (key.length === 0) {
    return key;
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// 7. Value format ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function formatValue(value: unknown): string {
  const raw =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
      ? `${value}`
      : JSON.stringify(value);
  const formatted = raw.replaceAll("\n", "\n    ");
  return formatted;
}

// 8. Context sanitize ―――――――――――――――――――――――――――――――――――――――――――――――――――――
function sanitizeContext(context: LogContext): LogContext {
  const sanitized: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (isSecretKey(key)) {
      sanitized[key] = "<redacted>";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// 9. Secret key check ―――――――――――――――――――――――――――――――――――――――――――――――――――――
function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes("token") ||
    lower.includes("authorization") ||
    lower.includes("secret") ||
    lower === "key" ||
    lower.endsWith("key")
  );
}
