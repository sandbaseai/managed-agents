import { nanoid } from 'nanoid';
import type { Database } from '@/core/db/database.js';
import type { SessionManager } from '@/core/session/session-manager.js';

export type SchedulerRunResult = {
  id: string;
  schedule_id: string;
  session_id: string | null;
  status: string;
  trigger_type: string;
  payload: string;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

export function nextCronRun(cron: string, after: Date = new Date()): Date | null {
  const schedule = parseCron(cron);
  if (!schedule) return null;
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const deadline = new Date(after.getTime() + 366 * 24 * 60 * 60 * 1000);
  while (cursor <= deadline) {
    if (
      schedule.minutes.has(cursor.getUTCMinutes())
      && schedule.hours.has(cursor.getUTCHours())
      && schedule.months.has(cursor.getUTCMonth() + 1)
      && schedule.daysOfMonth.has(cursor.getUTCDate())
      && schedule.daysOfWeek.has(cursor.getUTCDay())
    ) {
      return cursor;
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

export function runDueScheduledDeployments(
  db: Database,
  sessionManager: SessionManager,
  opts: { now?: Date } = {},
): SchedulerRunResult[] {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const rows = db.prepare(
    `SELECT *
     FROM scheduled_deployments
     WHERE archived_at IS NULL
       AND status = 'active'
       AND next_run_at IS NOT NULL
       AND next_run_at <= ?
     ORDER BY next_run_at ASC, created_at ASC
     LIMIT 50`,
  ).all(nowIso) as ScheduleRow[];
  return rows.map((schedule) => runSchedule(db, sessionManager, schedule, 'scheduled', now));
}

export function runSchedule(
  db: Database,
  sessionManager: SessionManager,
  schedule: ScheduleRow,
  triggerType: string,
  startedAtDate: Date = new Date(),
): SchedulerRunResult {
  const runId = `srun_${nanoid(18)}`;
  const startedAt = startedAtDate.toISOString();
  const payload = parseObject(schedule.payload);
  const nextRun = nextCronRun(schedule.cron, startedAtDate)?.toISOString() ?? null;
  try {
    const session = sessionManager.create({
      agent: schedule.agent_id,
      environmentId: schedule.environment_id ?? undefined,
      title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : `Scheduled run: ${schedule.name}`,
      metadata: {
        scheduled_deployment_id: schedule.id,
        scheduled_deployment_run_id: runId,
        trigger_type: triggerType,
      },
    });
    db.prepare(
      `INSERT INTO scheduled_deployment_runs (
        id, schedule_id, session_id, status, trigger_type, payload, error, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, schedule.id, session.id, 'created_session', triggerType, JSON.stringify(payload), null, startedAt, new Date().toISOString());
    db.prepare(
      'UPDATE scheduled_deployments SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
    ).run(startedAt, nextRun, new Date().toISOString(), schedule.id);
  } catch (err) {
    db.prepare(
      `INSERT INTO scheduled_deployment_runs (
        id, schedule_id, session_id, status, trigger_type, payload, error, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, schedule.id, null, 'failed', triggerType, JSON.stringify(payload), err instanceof Error ? err.message : String(err), startedAt, new Date().toISOString());
    db.prepare(
      'UPDATE scheduled_deployments SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
    ).run(startedAt, nextRun, new Date().toISOString(), schedule.id);
  }
  return db.prepare('SELECT * FROM scheduled_deployment_runs WHERE id = ?').get(runId) as SchedulerRunResult;
}

function parseCron(cron: string): ParsedCron | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const parsed = {
    minutes: parseField(minute, 0, 59),
    hours: parseField(hour, 0, 23),
    daysOfMonth: parseField(dayOfMonth, 1, 31),
    months: parseField(month, 1, 12),
    daysOfWeek: parseField(dayOfWeek, 0, 6),
  };
  return Object.values(parsed).every((set) => set.size > 0) ? parsed : null;
}

function parseField(value: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const rawPart of value.split(',')) {
    const [rangePart, stepPart] = rawPart.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) continue;
    const [start, end] = rangePart === '*'
      ? [min, max]
      : rangePart.includes('-')
        ? rangePart.split('-').map(Number)
        : [Number(rangePart), Number(rangePart)];
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    for (let value = Math.max(min, start); value <= Math.min(max, end); value += step) out.add(value);
  }
  return out;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export type ScheduleRow = {
  id: string;
  name: string;
  agent_id: string;
  environment_id: string | null;
  cron: string;
  payload: string;
};

type ParsedCron = {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
};
