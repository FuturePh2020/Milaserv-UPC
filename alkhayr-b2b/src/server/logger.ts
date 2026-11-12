import type { LogLevel } from './config.ts';

/**
 * Minimal structured JSON-lines logger. Callers pass explicit, safe fields;
 * as a second line of defence, keys that look sensitive are redacted.
 * Never log request bodies, headers, cookies, tokens, passwords or secrets.
 */
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|authorization|totp|otp|csrf|session|key$/i;

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    // Booleans (e.g. "appSecretConfigured") cannot carry secret material.
    if (SENSITIVE_KEY.test(k) && typeof v !== 'boolean') out[k] = '[REDACTED]';
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else out[k] = v;
  }
  return out;
}

export interface LoggerSink {
  write(line: string): void;
}

export function createLogger(level: LogLevel, sink: LoggerSink = process.stdout, errSink: LoggerSink = process.stderr): Logger {
  const min = LEVELS[level];
  const emit = (lvl: LogLevel, event: string, fields?: LogFields) => {
    if (LEVELS[lvl] < min) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: lvl, event, ...(fields ? redact(fields) : {}) });
    (lvl === 'error' || lvl === 'warn' ? errSink : sink).write(line + '\n');
  };
  return {
    debug: (e, f) => emit('debug', e, f),
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
  };
}
