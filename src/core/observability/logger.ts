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

export interface LogRecord {
  level: LogLevel;
  time: string;
  msg: string;
  [key: string]: unknown;
}

export interface StoredLogEntry extends LogRecord {
  line: string;
}

export interface LogQuery {
  limit?: number;
  level?: LogLevel;
  query?: string;
}

export interface LogStore {
  append(entry: StoredLogEntry): void;
  list(query?: LogQuery): StoredLogEntry[];
}

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
  /** Optional in-process ring buffer used by the local Console. */
  logStore?: LogStore;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? (process.env['MANAGED_AGENTS_LOG_LEVEL'] as LogLevel) ?? 'info';
  const pretty = opts.pretty ?? process.env['MANAGED_AGENTS_LOG_FORMAT'] === 'pretty';
  const threshold = LEVELS[level] ?? LEVELS.info;
  const bindings = opts.bindings ?? {};
  const write = opts.write ?? ((line: string) => process.stderr.write(line + '\n'));
  const logStore = opts.logStore;

  const log = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[lvl] < threshold) return;
    const record: LogRecord = { level: lvl, time: new Date().toISOString(), msg, ...bindings, ...fields };
    let line: string;
    if (pretty) {
      const extra = { ...bindings, ...fields };
      const extraStr = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
      line = `[${record.time}] ${lvl.toUpperCase()} ${msg}${extraStr}`;
    } else {
      line = JSON.stringify(record);
    }
    logStore?.append({ ...record, line });
    write(line);
  };

  return {
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    child: (childBindings) =>
      createLogger({ level, pretty, bindings: { ...bindings, ...childBindings }, write, logStore }),
  };
}

export class InMemoryLogStore implements LogStore {
  private entries: StoredLogEntry[] = [];

  constructor(private readonly maxEntries = 2000) {}

  append(entry: StoredLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  list(query: LogQuery = {}): StoredLogEntry[] {
    const limit = clampLimit(query.limit);
    const needle = query.query?.trim().toLowerCase();
    const threshold = query.level ? LEVELS[query.level] : undefined;
    const filtered = this.entries.filter((entry) => {
      if (threshold && LEVELS[entry.level] < threshold) return false;
      if (needle && !entry.line.toLowerCase().includes(needle)) return false;
      return true;
    });
    return filtered.slice(-limit);
  }
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 200;
  return Math.max(1, Math.min(1000, Math.trunc(value ?? 200)));
}
