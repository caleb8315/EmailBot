type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

let minLevel: LogLevel = resolveMinLevel();

/**
 * Exposed for tests / dashboard tooling that wants to change verbosity at
 * runtime without mutating process.env.
 */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function getLogLevel(): LogLevel {
  return minLevel;
}

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function emit(
  level: LogLevel,
  module: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  if (!shouldEmit(level)) return;
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

function createModuleLogger(module: string) {
  return {
    info: (message: string, meta?: Record<string, unknown>) =>
      emit("info", module, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) =>
      emit("warn", module, message, meta),
    error: (message: string, meta?: Record<string, unknown>) =>
      emit("error", module, message, meta),
    debug: (message: string, meta?: Record<string, unknown>) =>
      emit("debug", module, message, meta),
  };
}

export const log = createModuleLogger("system");

export function createLogger(module: string) {
  return createModuleLogger(module);
}
