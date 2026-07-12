/**
 * Workspace Snapshot Manager (Requirement 9.11)
 *
 * Periodically (or on demand) archives a Sandbox working directory to a tar.gz
 * so a Session can restore its file-system contents when it continues after
 * its sandbox has been re-provisioned. Event_Log
 * replay restores the conversation; snapshots restore the actual bytes.
 *
 * Snapshots are recorded in the `snapshots` table. This uses the `tar` CLI
 * (universally available on macOS/Linux) to avoid a native/npm tar dependency.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';
import type { Database } from '@/core/db/database.js';

export interface SnapshotRecord {
  id: string;
  sessionId: string;
  path: string;
  sizeBytes: number;
  createdAt: Date;
}

export class SnapshotManager {
  constructor(
    private readonly db: Database,
    private readonly snapshotDir: string,
  ) {}

  /**
   * Archive `workDir` into a tar.gz and record it. Returns the snapshot record.
   */
  create(sessionId: string, workDir: string): SnapshotRecord {
    if (!existsSync(workDir)) {
      throw new Error(`Cannot snapshot: working directory does not exist: ${workDir}`);
    }
    const id = `snap_${nanoid(12)}`;
    const outPath = join(this.snapshotDir, sessionId, `${id}.tar.gz`);
    mkdirSync(dirname(outPath), { recursive: true });

    // tar -czf <out> -C <workDir> .
    const r = spawnSync('tar', ['-czf', outPath, '-C', workDir, '.'], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (r.status !== 0) {
      throw new Error(`tar failed: ${r.stderr || 'unknown error'}`);
    }

    const sizeBytes = existsSync(outPath) ? statSync(outPath).size : 0;
    this.db
      .prepare('INSERT INTO snapshots (id, session_id, path, size_bytes) VALUES (?, ?, ?, ?)')
      .run(id, sessionId, outPath, sizeBytes);

    return { id, sessionId, path: outPath, sizeBytes, createdAt: new Date() };
  }

  /**
   * Restore the most recent snapshot for a session into `workDir`.
   * Returns false if no snapshot exists.
   */
  restoreLatest(sessionId: string, workDir: string): boolean {
    const row = this.db
      .prepare('SELECT path FROM snapshots WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(sessionId) as { path: string } | undefined;
    if (!row || !existsSync(row.path)) return false;

    mkdirSync(workDir, { recursive: true });
    const r = spawnSync('tar', ['-xzf', row.path, '-C', workDir], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
    return r.status === 0;
  }

  /** List snapshots for a session, newest first. */
  list(sessionId: string): SnapshotRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM snapshots WHERE session_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(sessionId) as unknown as Array<{
      id: string;
      session_id: string;
      path: string;
      size_bytes: number;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      path: r.path,
      sizeBytes: r.size_bytes,
      createdAt: new Date(r.created_at),
    }));
  }
}
