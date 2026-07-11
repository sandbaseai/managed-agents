/**
 * Database Layer
 *
 * Uses Node.js built-in node:sqlite (experimental in Node 22+, stable in Node 25+).
 * Provides a synchronous SQLite interface with auto-migration support.
 */

import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS, type Migration } from './migrations.js';

// Load node:sqlite via createRequire so bundlers (esbuild/tsup) don't rewrite
// the specifier. A static `import ... from 'node:sqlite'` gets its node:
// prefix stripped during bundling, producing an unresolvable bare 'sqlite'.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export class Database {
  private db: InstanceType<typeof DatabaseSync>;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  /**
   * Execute raw SQL (no return value).
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Prepare a statement for parameterized queries.
   */
  prepare(sql: string) {
    return this.db.prepare(sql);
  }

  /**
   * Run a function inside a transaction. Auto-rollback on error.
   */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Run all pending migrations. Defaults to the embedded MIGRATIONS array
   * (bundle-safe). Each migration runs exactly once, tracked in _migrations.
   * Idempotent — running repeatedly is a no-op once applied.
   */
  runMigrations(migrations: Migration[] = MIGRATIONS): void {
    // Create migrations tracking table
    this.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Get applied versions
    const applied = new Set<number>();
    const rows = this.prepare('SELECT version FROM _migrations').all() as Array<{ version: number }>;
    for (const row of rows) {
      applied.add(row.version);
    }

    // Run pending migrations in ascending version order
    const pending = [...migrations].sort((a, b) => a.version - b.version);
    for (const migration of pending) {
      if (applied.has(migration.version)) continue;
      this.transaction(() => {
        this.exec(migration.sql);
        this.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(
          migration.version,
          migration.name,
        );
      });
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
