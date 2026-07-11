/**
 * Structured Logger (F3)
 *
 * Zero-dependency JSON logger. Emits one JSON object per line to stderr (so
 * stdout stays clean for the startup banner / CLI output). Log level is
 * controlled by MANAGED_AGENTS_LOG_LEVEL (debug|info|warn|error), default info.
 * Set MANAGED_AGENTS_LOG_FORMAT=pretty for human-readable dev output.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  pretty?: boolean;
  bindings?: Record<string, unknown>;
  /** Sink for testing; defaults to stderr. */
  write?: (line: string) => void;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? (process.env['MANAGED_AGENTS_LOG_LEVEL'] as LogLevel) ?? 'info';
  const pretty = opts.pretty ?? process.env['MANAGED_AGENTS_LOG_FORMAT'] === 'pretty';
  const threshold = LEVELS[level] ?? LEVELS.info;
  const bindings = opts.bindings ?? {};
  const write = opts.write ?? ((line: string) => process.stderr.write(line + '\n'));

  const log = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[lvl] < threshold) return;
    const record = { level: lvl, time: new Date().toISOString(), msg, ...bindings, ...fields };
    if (pretty) {
      const extra = { ...bindings, ...fields };
      const extraStr = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
      write(`[${record.time}] ${lvl.toUpperCase()} ${msg}${extraStr}`);
    } else {
      write(JSON.stringify(record));
    }
  };

  return {
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    child: (childBindings) =>
      createLogger({ level, pretty, bindings: { ...bindings, ...childBindings }, write }),
  };
}
