export declare type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export declare type Logger = {
  level: LogLevel;
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
  child(context: LogContext): Logger;
};

export declare type LogContext = Record<string, unknown>;

type LogSink = {
  debug(line: string): void;
  info(line: string): void;
  log(line: string): void;
  warn(line: string): void;
  error(line: string): void;
};

const LOG_CONFIG = {
  "line": {
    "str": `―――――――――――――――――――――――――――――――――――――――――`,
    "color": `\u001B[38;2;255;162;0m`,
  },
  "debug": {
    "str": `[D]`,
    "color": `\u001B[38;5;141m`,
  },
  "info": {
    "str": `[I]`,
    "color": `\u001B[38;5;111m`,
  },
  "warn": {
    "str": `[W]`,
    "color": `\u001B[38;5;220m`,
  },
  "error": {
    "str": `[E]`,
    "color": `\u001B[38;5;196m`,
  },
  "reset": {
    "str": ``,
    "color": `\u001B[0m`,
  },
} as const;

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
  defCtx: LogContext = {},
  sink: LogSink = console,
): Logger {
  const logger: Logger = {
    level,
    debug: (event: string, context: LogContext = {}) => {
      writeLog("debug", event, level, defCtx, context, sink);
    },
    info: (event: string, context: LogContext = {}) => {
      writeLog("info", event, level, defCtx, context, sink);
    },
    warn: (event: string, context: LogContext = {}) => {
      writeLog("warn", event, level, defCtx, context, sink);
    },
    error: (event: string, context: LogContext = {}) => {
      writeLog("error", event, level, defCtx, context, sink);
    },
    child: (context: LogContext) =>
      createLogger(level, { ...defCtx, ...context }, sink),
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
  defCtx: LogContext,
  context: LogContext,
  sink: LogSink,
): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel]) {
    return;
  }

  const cfg = LOG_CONFIG[level];
  const separator = `${LOG_CONFIG.line.color}${LOG_CONFIG.line.str}${LOG_CONFIG.reset.color}`;
  const header = `${cfg.color}${cfg.str}${LOG_CONFIG.reset.color} ${cfg.color}${event}${LOG_CONFIG.reset.color}`;
  const mrgdCtx = {
    time: new Date().toISOString(),
    ...sanitizeContext(defCtx),
    ...sanitizeContext(context),
  };
  const line = `${separator}\n${header}\n${formatContext(mrgdCtx, cfg.color)}`;

  if (level === "debug") {
    sink.debug(line);
  }
  else if (level === "info") {
    sink.info(line);
  }
  else if (level === "warn") {
    sink.warn(line);
  }
  else {
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
    const labeled = `${keyColor}- ${titleCaseKey(key)} :${LOG_CONFIG.reset.color}`;
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
    }
    else {
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
