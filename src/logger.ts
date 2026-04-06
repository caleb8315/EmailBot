type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  [key: string]: unknown;
}

function emit(
  level: LogLevel,
  module: string,
  message: string,
  meta?: Record<string, unknown>
): void {
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
