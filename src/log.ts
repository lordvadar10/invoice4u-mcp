/**
 * Logging goes to stderr — stdout carries the MCP protocol and must stay clean.
 * Secrets are redacted on the way out as a second line of defence.
 */

import type { LogLevel } from "./config.js";
import { redact } from "./invoice4u/errors.js";

const ORDER: Readonly<Record<LogLevel, number>> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

export function createLogger(level: LogLevel, ...secrets: (string | undefined)[]): Logger {
  const threshold = ORDER[level];
  const emit = (at: LogLevel, message: string): void => {
    if (ORDER[at] > threshold) return;
    process.stderr.write(`[invoice4u-mcp] ${at}: ${redact(message, ...secrets)}\n`);
  };
  return {
    error: (m) => emit("error", m),
    warn: (m) => emit("warn", m),
    info: (m) => emit("info", m),
    debug: (m) => emit("debug", m),
  };
}
