import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { nextCronRun, runDueScheduledDeployments } from '@/core/operations/scheduler.js';

describe('scheduled deployment runner', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-sched-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'Default', '{}')`);
    db.exec(`INSERT INTO agents (id, name, definition) VALUES ('agent_echo', 'echo', '{"name":"echo","model":"default"}')`);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('computes the next cron run in UTC', () => {
    expect(nextCronRun('*/15 * * * *', new Date('2026-07-23T10:07:30Z'))?.toISOString()).toBe('2026-07-23T10:15:00.000Z');
    expect(nextCronRun('0 9 * * 1', new Date('2026-07-20T09:00:00Z'))?.toISOString()).toBe('2026-07-27T09:00:00.000Z');
  });

  it('runs due schedules and advances next_run_at', () => {
    db.prepare(
      `INSERT INTO scheduled_deployments (
        id, name, agent_id, environment_id, cron, payload, status, next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sched_due',
      'Due schedule',
      'agent_echo',
      'env_default',
      '*/5 * * * *',
      JSON.stringify({ title: 'Due schedule session' }),
      'active',
      '2026-07-23T10:00:00.000Z',
      '2026-07-23T09:00:00.000Z',
      '2026-07-23T09:00:00.000Z',
    );

    const runs = runDueScheduledDeployments(db, new SessionManager(db), { now: new Date('2026-07-23T10:01:00.000Z') });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ schedule_id: 'sched_due', status: 'created_session', trigger_type: 'scheduled' });
    const schedule = db.prepare('SELECT next_run_at, last_run_at FROM scheduled_deployments WHERE id = ?').get('sched_due') as { next_run_at: string; last_run_at: string };
    expect(schedule.last_run_at).toBe('2026-07-23T10:01:00.000Z');
    expect(schedule.next_run_at).toBe('2026-07-23T10:05:00.000Z');
  });
});
