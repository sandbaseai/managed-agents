import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { createHmac } from 'node:crypto';
import type { ServerDeps } from '../server.js';
import { pageOf } from '../standard.js';
import { dispatchWebhookEvent, retryDueWebhookDeliveries } from '@/core/operations/webhook-dispatcher.js';
import { nextCronRun, runDueScheduledDeployments, runSchedule, type ScheduleRow } from '@/core/operations/scheduler.js';
import { evaluateDeterministicOutcome, type OutcomeEvaluationInput, type OutcomeEvaluationResult } from '@/core/operations/outcome-evaluator.js';

type JsonObject = Record<string, unknown>;

export function operationsRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get('/webhooks', (c) => {
    const rows = deps.db.prepare('SELECT * FROM webhooks WHERE archived_at IS NULL ORDER BY created_at DESC').all() as WebhookRow[];
    return c.json(pageOf(rows.map(toWebhook)));
  });

  app.post('/webhooks', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const url = stringField(body.value.url);
    if (!url || !isHttpUrl(url)) return invalid(c, 'url must be an http(s) URL');
    const events = stringArray(body.value.events);
    if (events.length === 0) return invalid(c, 'events must contain at least one event name');
    const id = `wh_${nanoid(18)}`;
    deps.db.prepare(`
      INSERT INTO webhooks (id, name, url, events, description, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      stringField(body.value.name) ?? new URL(url).host,
      url,
      JSON.stringify(events),
      stringField(body.value.description) ?? '',
      JSON.stringify(objectField(body.value.metadata)),
      now(),
      now(),
    );
    const row = deps.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as WebhookRow;
    return c.json(toWebhook(row), 201);
  });

  app.post('/webhooks/dispatch', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const event = stringField(body.value.event);
    if (!event) return invalid(c, 'event is required');
    const deliveries = await dispatchWebhookEvent(deps.db, {
      event,
      data: objectField(body.value.data),
      id: stringField(body.value.id),
    }, { secret: webhookSecret(deps) });
    return c.json(pageOf(deliveries), 202);
  });

  app.post('/webhooks/retry-due', async (c) => {
    const deliveries = await retryDueWebhookDeliveries(deps.db, { secret: webhookSecret(deps) });
    return c.json(pageOf(deliveries), 202);
  });

  app.get('/webhooks/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM webhooks WHERE id = ? AND archived_at IS NULL').get(c.req.param('id')) as WebhookRow | undefined;
    return row ? c.json(toWebhook(row)) : notFound(c, 'Webhook not found');
  });

  app.put('/webhooks/:id', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const id = c.req.param('id');
    const existing = deps.db.prepare('SELECT * FROM webhooks WHERE id = ? AND archived_at IS NULL').get(id) as WebhookRow | undefined;
    if (!existing) return notFound(c, 'Webhook not found');
    const url = body.value.url === undefined ? existing.url : stringField(body.value.url);
    if (!url || !isHttpUrl(url)) return invalid(c, 'url must be an http(s) URL');
    const events = body.value.events === undefined ? parseArray(existing.events) : stringArray(body.value.events);
    if (events.length === 0) return invalid(c, 'events must contain at least one event name');
    deps.db.prepare(`
      UPDATE webhooks
      SET name = ?, url = ?, events = ?, description = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `).run(
      stringField(body.value.name) ?? existing.name,
      url,
      JSON.stringify(events),
      stringField(body.value.description) ?? existing.description,
      JSON.stringify(body.value.metadata === undefined ? parseObject(existing.metadata) : objectField(body.value.metadata)),
      now(),
      id,
    );
    const row = deps.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as WebhookRow;
    return c.json(toWebhook(row));
  });

  app.post('/webhooks/:id/archive', (c) => archiveById(c, deps, 'webhooks', toWebhook, 'Webhook not found'));

  app.get('/webhooks/:id/deliveries', (c) => {
    const webhook = deps.db.prepare('SELECT id FROM webhooks WHERE id = ? AND archived_at IS NULL').get(c.req.param('id'));
    if (!webhook) return notFound(c, 'Webhook not found');
    const rows = deps.db.prepare('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC').all(c.req.param('id')) as WebhookDeliveryRow[];
    return c.json(pageOf(rows.map(toWebhookDelivery)));
  });

  app.post('/webhooks/:id/test', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const webhook = deps.db.prepare('SELECT * FROM webhooks WHERE id = ? AND archived_at IS NULL').get(c.req.param('id')) as WebhookRow | undefined;
    if (!webhook) return notFound(c, 'Webhook not found');
    const event = stringField(body.value.event) ?? parseArray(webhook.events)[0] ?? 'test';
    const payload = {
      type: 'webhook_test',
      event,
      webhook_id: webhook.id,
      data: objectField(body.value.payload),
      created_at: now(),
    };
    const payloadJson = JSON.stringify(payload);
    const signature = signWebhookPayload(payloadJson, deps.workspace?.dataDir ?? 'managed-agents');
    const id = `whd_${nanoid(18)}`;
    deps.db.prepare(`
      INSERT INTO webhook_deliveries (
        id, webhook_id, event, payload, status, status_code, error, signature, created_at, delivered_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      webhook.id,
      event,
      payloadJson,
      'simulated',
      202,
      null,
      signature,
      now(),
      now(),
    );
    const row = deps.db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(id) as WebhookDeliveryRow;
    return c.json(toWebhookDelivery(row), 202);
  });

  app.get('/scheduled-deployments', (c) => {
    const rows = deps.db.prepare('SELECT * FROM scheduled_deployments WHERE archived_at IS NULL ORDER BY created_at DESC').all() as ScheduledDeploymentRow[];
    return c.json(pageOf(rows.map(toScheduledDeployment)));
  });

  app.post('/scheduled-deployments', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    const agentId = stringField(body.value.agent_id) ?? stringField(body.value.agent);
    const cron = stringField(body.value.cron);
    if (!name) return invalid(c, 'name is required');
    if (!agentId) return invalid(c, 'agent_id is required');
    if (!cron) return invalid(c, 'cron is required');
    if (!looksLikeCron(cron)) return invalid(c, 'cron must contain five fields');
    const id = `sched_${nanoid(18)}`;
    deps.db.prepare(`
      INSERT INTO scheduled_deployments (
        id, name, agent_id, environment_id, cron, payload, status, next_run_at, metadata, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      agentId,
      stringField(body.value.environment_id) ?? null,
      cron,
      JSON.stringify(objectField(body.value.payload)),
      normalizeScheduleStatus(body.value.status),
      stringField(body.value.next_run_at) ?? nextCronRun(cron)?.toISOString() ?? null,
      JSON.stringify(objectField(body.value.metadata)),
      now(),
      now(),
    );
    const row = deps.db.prepare('SELECT * FROM scheduled_deployments WHERE id = ?').get(id) as ScheduledDeploymentRow;
    return c.json(toScheduledDeployment(row), 201);
  });

  app.post('/scheduled-deployments/run-due', (c) => {
    const runs = runDueScheduledDeployments(deps.db, deps.sessionManager);
    return c.json(pageOf(runs.map(toScheduledDeploymentRun)), 202);
  });

  app.get('/scheduled-deployments/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM scheduled_deployments WHERE id = ? AND archived_at IS NULL').get(c.req.param('id')) as ScheduledDeploymentRow | undefined;
    return row ? c.json(toScheduledDeployment(row)) : notFound(c, 'Scheduled deployment not found');
  });

  app.put('/scheduled-deployments/:id', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const id = c.req.param('id');
    const existing = deps.db.prepare('SELECT * FROM scheduled_deployments WHERE id = ? AND archived_at IS NULL').get(id) as ScheduledDeploymentRow | undefined;
    if (!existing) return notFound(c, 'Scheduled deployment not found');
    const cron = body.value.cron === undefined ? existing.cron : stringField(body.value.cron);
    if (!cron || !looksLikeCron(cron)) return invalid(c, 'cron must contain five fields');
    deps.db.prepare(`
      UPDATE scheduled_deployments
      SET name = ?, agent_id = ?, environment_id = ?, cron = ?, payload = ?, status = ?,
          next_run_at = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `).run(
      stringField(body.value.name) ?? existing.name,
      stringField(body.value.agent_id) ?? stringField(body.value.agent) ?? existing.agent_id,
      body.value.environment_id === undefined ? existing.environment_id : stringField(body.value.environment_id) ?? null,
      cron,
      JSON.stringify(body.value.payload === undefined ? parseObject(existing.payload) : objectField(body.value.payload)),
      normalizeScheduleStatus(body.value.status ?? existing.status),
      body.value.next_run_at === undefined ? existing.next_run_at : stringField(body.value.next_run_at) ?? nextCronRun(cron)?.toISOString() ?? null,
      JSON.stringify(body.value.metadata === undefined ? parseObject(existing.metadata) : objectField(body.value.metadata)),
      now(),
      id,
    );
    const row = deps.db.prepare('SELECT * FROM scheduled_deployments WHERE id = ?').get(id) as ScheduledDeploymentRow;
    return c.json(toScheduledDeployment(row));
  });

  app.post('/scheduled-deployments/:id/archive', (c) => archiveById(c, deps, 'scheduled_deployments', toScheduledDeployment, 'Scheduled deployment not found'));

  app.get('/scheduled-deployments/:id/runs', (c) => {
    const schedule = deps.db.prepare('SELECT id FROM scheduled_deployments WHERE id = ? AND archived_at IS NULL').get(c.req.param('id'));
    if (!schedule) return notFound(c, 'Scheduled deployment not found');
    const rows = deps.db.prepare('SELECT * FROM scheduled_deployment_runs WHERE schedule_id = ? ORDER BY started_at DESC').all(c.req.param('id')) as ScheduledDeploymentRunRow[];
    return c.json(pageOf(rows.map(toScheduledDeploymentRun)));
  });

  app.post('/scheduled-deployments/:id/run', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const schedule = deps.db.prepare('SELECT * FROM scheduled_deployments WHERE id = ? AND archived_at IS NULL').get(c.req.param('id')) as ScheduledDeploymentRow | undefined;
    if (!schedule) return notFound(c, 'Scheduled deployment not found');
    if (schedule.status !== 'active') return invalid(c, 'scheduled deployment must be active before it can run');
    const payload = {
      ...parseObject(schedule.payload),
      ...objectField(body.value.payload),
    };
    const manualSchedule = {
      ...schedule,
      payload: JSON.stringify(payload),
    };
    try {
      const row = runSchedule(deps.db, deps.sessionManager, manualSchedule, stringField(body.value.trigger_type) ?? 'manual');
      return c.json(toScheduledDeploymentRun(row), 201);
    } catch (err: any) {
      return c.json({ error: { type: 'internal_error', message: err?.message ?? String(err) } }, 500);
    }
  });

  app.get('/outcomes', (c) => {
    const rows = deps.db.prepare('SELECT * FROM outcomes WHERE archived_at IS NULL ORDER BY created_at DESC').all() as OutcomeRow[];
    return c.json(pageOf(rows.map(toOutcome)));
  });

  app.post('/outcomes', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    const objective = stringField(body.value.objective);
    if (!name) return invalid(c, 'name is required');
    if (!objective) return invalid(c, 'objective is required');
    const metadata = {
      ...objectField(body.value.metadata),
      ...(body.value.pass_threshold !== undefined ? { pass_threshold: thresholdField(body.value.pass_threshold) } : {}),
      ...(body.value.evaluator !== undefined ? { evaluator: stringField(body.value.evaluator) ?? 'deterministic_transcript_matcher' } : {}),
    };
    const id = `out_${nanoid(18)}`;
    deps.db.prepare(`
      INSERT INTO outcomes (id, name, description, objective, criteria, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      stringField(body.value.description) ?? '',
      objective,
      JSON.stringify(stringArray(body.value.criteria)),
      JSON.stringify(metadata),
      now(),
      now(),
    );
    const row = deps.db.prepare('SELECT * FROM outcomes WHERE id = ?').get(id) as OutcomeRow;
    return c.json(toOutcome(row), 201);
  });

  app.get('/outcomes/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM outcomes WHERE id = ? AND archived_at IS NULL').get(c.req.param('id')) as OutcomeRow | undefined;
    return row ? c.json(toOutcome(row)) : notFound(c, 'Outcome not found');
  });

  app.put('/outcomes/:id', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const id = c.req.param('id');
    const existing = deps.db.prepare('SELECT * FROM outcomes WHERE id = ? AND archived_at IS NULL').get(id) as OutcomeRow | undefined;
    if (!existing) return notFound(c, 'Outcome not found');
    const name = stringField(body.value.name) ?? existing.name;
    const objective = stringField(body.value.objective) ?? existing.objective;
    const existingMetadata = parseObject(existing.metadata);
    const nextMetadata = body.value.metadata === undefined ? existingMetadata : objectField(body.value.metadata);
    if (body.value.pass_threshold !== undefined) nextMetadata.pass_threshold = thresholdField(body.value.pass_threshold);
    if (body.value.evaluator !== undefined) nextMetadata.evaluator = stringField(body.value.evaluator) ?? existingMetadata.evaluator ?? 'deterministic_transcript_matcher';
    deps.db.prepare(`
      UPDATE outcomes
      SET name = ?, description = ?, objective = ?, criteria = ?, metadata = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      stringField(body.value.description) ?? existing.description,
      objective,
      JSON.stringify(body.value.criteria === undefined ? parseArray(existing.criteria) : stringArray(body.value.criteria)),
      JSON.stringify(nextMetadata),
      normalizeOutcomeStatus(body.value.status ?? existing.status),
      now(),
      id,
    );
    const row = deps.db.prepare('SELECT * FROM outcomes WHERE id = ?').get(id) as OutcomeRow;
    return c.json(toOutcome(row));
  });

  app.post('/outcomes/:id/archive', (c) => archiveById(c, deps, 'outcomes', toOutcome, 'Outcome not found'));

  app.get('/sessions/:id/outcomes', (c) => {
    const session = deps.db.prepare('SELECT id FROM sessions WHERE id = ?').get(c.req.param('id'));
    if (!session) return notFound(c, 'Session not found');
    const rows = deps.db.prepare('SELECT * FROM session_outcomes WHERE session_id = ? ORDER BY created_at DESC').all(c.req.param('id')) as SessionOutcomeRow[];
    return c.json(pageOf(rows.map(toSessionOutcome)));
  });

  app.post('/sessions/:id/outcomes', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const sessionId = c.req.param('id');
    const session = deps.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return notFound(c, 'Session not found');
    const outcomeId = stringField(body.value.outcome_id);
    if (outcomeId) {
      const outcome = deps.db.prepare('SELECT id FROM outcomes WHERE id = ? AND archived_at IS NULL').get(outcomeId);
      if (!outcome) return notFound(c, 'Outcome not found');
    }
    const status = normalizeSessionOutcomeStatus(body.value.status);
    const id = `sout_${nanoid(18)}`;
    deps.db.prepare(`
      INSERT INTO session_outcomes (id, session_id, outcome_id, status, score, summary, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      outcomeId ?? null,
      status,
      numberField(body.value.score),
      stringField(body.value.summary) ?? '',
      JSON.stringify(objectField(body.value.details)),
      now(),
    );
    const row = deps.db.prepare('SELECT * FROM session_outcomes WHERE id = ?').get(id) as SessionOutcomeRow;
    return c.json(toSessionOutcome(row), 201);
  });

  app.post('/sessions/:id/outcomes/evaluate', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const sessionId = c.req.param('id');
    const session = deps.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return notFound(c, 'Session not found');
    const outcomeId = stringField(body.value.outcome_id);
    if (!outcomeId) return invalid(c, 'outcome_id is required');
    const outcome = deps.db.prepare('SELECT * FROM outcomes WHERE id = ? AND archived_at IS NULL').get(outcomeId) as OutcomeRow | undefined;
    if (!outcome) return notFound(c, 'Outcome not found');
    const transcript = sessionTranscript(deps, sessionId);
    const criteria = parseArray(outcome.criteria);
    const result = await evaluateOutcome(deps, {
      transcript,
      criteria,
      objective: outcome.objective,
      passThreshold: outcomeThreshold(outcome),
      evaluator: outcomeEvaluator(outcome),
    });
    const id = `sout_${nanoid(18)}`;
    deps.db.prepare(`
      INSERT INTO session_outcomes (id, session_id, outcome_id, status, score, summary, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      outcomeId,
      result.status,
      result.score,
      result.summary,
      JSON.stringify(result.details),
      now(),
    );
    const row = deps.db.prepare('SELECT * FROM session_outcomes WHERE id = ?').get(id) as SessionOutcomeRow;
    return c.json(toSessionOutcome(row), 201);
  });

  return app;
}

function toWebhook(row: WebhookRow) {
  return {
    id: row.id,
    type: 'webhook',
    name: row.name,
    url: row.url,
    events: parseArray(row.events),
    description: row.description,
    status: row.archived_at ? 'archived' : row.status,
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function toWebhookDelivery(row: WebhookDeliveryRow) {
  return {
    id: row.id,
    type: 'webhook_delivery',
    webhook_id: row.webhook_id,
    event: row.event,
    payload: parseObject(row.payload),
    status: row.status,
    status_code: row.status_code,
    error: row.error ?? null,
    signature: row.signature,
    attempt_count: row.attempt_count ?? 0,
    next_retry_at: row.next_retry_at ?? null,
    created_at: row.created_at,
    delivered_at: row.delivered_at ?? null,
  };
}

function toScheduledDeployment(row: ScheduledDeploymentRow) {
  return {
    id: row.id,
    type: 'scheduled_deployment',
    name: row.name,
    agent_id: row.agent_id,
    environment_id: row.environment_id ?? null,
    cron: row.cron,
    payload: parseObject(row.payload),
    status: row.archived_at ? 'archived' : row.status,
    last_run_at: row.last_run_at ?? null,
    next_run_at: row.next_run_at ?? null,
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function toScheduledDeploymentRun(row: ScheduledDeploymentRunRow) {
  return {
    id: row.id,
    type: 'scheduled_deployment_run',
    schedule_id: row.schedule_id,
    session_id: row.session_id ?? null,
    status: row.status,
    trigger_type: row.trigger_type,
    payload: parseObject(row.payload),
    error: row.error ?? null,
    started_at: row.started_at,
    completed_at: row.completed_at ?? null,
  };
}

function toOutcome(row: OutcomeRow) {
  const metadata = parseObject(row.metadata);
  return {
    id: row.id,
    type: 'outcome',
    name: row.name,
    description: row.description,
    objective: row.objective,
    criteria: parseArray(row.criteria),
    pass_threshold: outcomeThreshold(row),
    evaluator: typeof metadata.evaluator === 'string' ? metadata.evaluator : 'deterministic_transcript_matcher',
    metadata,
    status: row.archived_at ? 'archived' : row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function toSessionOutcome(row: SessionOutcomeRow) {
  return {
    id: row.id,
    type: 'session_outcome',
    session_id: row.session_id,
    outcome_id: row.outcome_id ?? null,
    status: row.status,
    score: row.score,
    summary: row.summary,
    details: parseObject(row.details),
    created_at: row.created_at,
  };
}

function archiveById<T>(
  c: any,
  deps: ServerDeps,
  table: string,
  map: (row: any) => T,
  missingMessage: string,
) {
  const id = c.req.param('id');
  const existing = deps.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND archived_at IS NULL`).get(id);
  if (!existing) return notFound(c, missingMessage);
  deps.db.prepare(`UPDATE ${table} SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?`).run('archived', now(), now(), id);
  const row = deps.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  return c.json(map(row));
}

async function readObjectBody(c: any): Promise<{ ok: true; value: JsonObject } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, response: invalid(c, 'Request body must be JSON') };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, response: invalid(c, 'Request body must be a JSON object') };
  }
  return { ok: true, value: body as JsonObject };
}

function invalid(c: any, message: string) {
  return c.json({ error: { type: 'invalid_request', message } }, 400);
}

function notFound(c: any, message: string) {
  return c.json({ error: { type: 'not_found', message } }, 404);
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function thresholdField(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return 0.75;
  return Math.min(1, Math.max(0, number));
}

function objectField(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
}

function parseObject(value: string | null): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return objectField(parsed);
  } catch {
    return {};
  }
}

function parseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return stringArray(parsed);
  } catch {
    return [];
  }
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function looksLikeCron(value: string) {
  return value.trim().split(/\s+/).length === 5;
}

function normalizeScheduleStatus(value: unknown): 'active' | 'paused' {
  return value === 'paused' ? 'paused' : 'active';
}

function normalizeOutcomeStatus(value: unknown): 'active' | 'disabled' {
  return value === 'disabled' ? 'disabled' : 'active';
}

function normalizeSessionOutcomeStatus(value: unknown): 'passed' | 'failed' | 'inconclusive' {
  if (value === 'passed' || value === 'failed' || value === 'inconclusive') return value;
  return 'inconclusive';
}

function now() {
  return new Date().toISOString();
}

function sessionTranscript(deps: ServerDeps, sessionId: string): string {
  const rows = deps.db.prepare('SELECT content FROM events WHERE session_id = ? ORDER BY seq ASC').all(sessionId) as Array<{ content: string | null }>;
  return rows
    .flatMap((row) => textBlocks(parseUnknownArray(row.content)))
    .join('\n')
    .toLowerCase();
}

function outcomeThreshold(row: OutcomeRow): number {
  const metadata = parseObject(row.metadata);
  return thresholdField(metadata.pass_threshold);
}

function outcomeEvaluator(row: OutcomeRow): string {
  const metadata = parseObject(row.metadata);
  return typeof metadata.evaluator === 'string' && metadata.evaluator.trim()
    ? metadata.evaluator.trim()
    : 'deterministic_transcript_matcher';
}

async function evaluateOutcome(deps: ServerDeps, input: OutcomeEvaluationInput): Promise<OutcomeEvaluationResult> {
  if (input.evaluator === 'model_assisted' || input.evaluator === 'model_assisted_json') {
    if (deps.evaluateOutcome) return deps.evaluateOutcome(input);
    return {
      status: 'inconclusive',
      score: 0,
      summary: 'Model-assisted evaluation is not configured for this runtime.',
      details: {
        evaluator: input.evaluator,
        pass_threshold: input.passThreshold,
        unsupported: true,
        reason: 'No model-assisted evaluator is registered.',
      },
    };
  }
  return evaluateDeterministicOutcome(input);
}

function parseUnknownArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function textBlocks(blocks: unknown[]): string[] {
  const output: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (typeof record.text === 'string') output.push(record.text);
    if (typeof record.content === 'string') output.push(record.content);
    if (Array.isArray(record.content)) output.push(...textBlocks(record.content));
  }
  return output;
}

function signWebhookPayload(payload: string, secret: string) {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

function webhookSecret(deps: ServerDeps) {
  return deps.workspace?.dataDir ?? 'managed-agents';
}

type WebhookRow = {
  id: string;
  name: string;
  url: string;
  events: string;
  description: string;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type WebhookDeliveryRow = {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  status: string;
  status_code: number | null;
  error: string | null;
  signature: string;
  attempt_count: number;
  next_retry_at: string | null;
  created_at: string;
  delivered_at: string | null;
};

type ScheduledDeploymentRow = {
  id: string;
  name: string;
  agent_id: string;
  environment_id: string | null;
  cron: string;
  payload: string;
  status: string;
  last_run_at: string | null;
  next_run_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type ScheduledDeploymentRunRow = {
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

type OutcomeRow = {
  id: string;
  name: string;
  description: string;
  objective: string;
  criteria: string;
  metadata: string;
  status: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type SessionOutcomeRow = {
  id: string;
  session_id: string;
  outcome_id: string | null;
  status: string;
  score: number | null;
  summary: string;
  details: string;
  created_at: string;
};
