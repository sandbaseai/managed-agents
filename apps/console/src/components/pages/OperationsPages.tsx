import { Activity, CalendarClock, CheckCircle2, Play, Plus, RadioTower, Send } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { postJson } from '../../api';
import type { ConsoleData, Outcome, ScheduledDeployment, Session, Webhook } from '../../types';
import { EmptyState, RequiredMark, ResourceBadge, StatusPill, SummaryStrip } from '../Common';
import { Modal } from '../Modal';
import { formatDateShort, truncateMiddle } from '../../lib/format';

type WebhookDelivery = {
  id: string;
  event: string;
  status: string;
  status_code: number | null;
  signature: string;
};

type ScheduledDeploymentRun = {
  id: string;
  schedule_id: string;
  session_id: string | null;
  status: string;
};

type SessionOutcome = {
  id: string;
  session_id: string;
  outcome_id: string | null;
  status: string;
  score: number | null;
  summary: string;
};

type OperationsPageProps = {
  data: ConsoleData;
  onRefresh: () => void;
};

export function WebhooksPage({ data, onRefresh }: OperationsPageProps) {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState('');

  const testWebhook = async (webhook: Webhook) => {
    setTestingId(webhook.id);
    setMessage('');
    try {
      const delivery = await postJson<WebhookDelivery>(`/v1/webhooks/${webhook.id}/test`, {
        event: webhook.events[0] ?? 'turn_complete',
        payload: { source: 'console', dry_run: true },
      });
      setMessage(`Test delivery ${truncateMiddle(delivery.id, 18)} recorded with ${delivery.status_code ?? 'no'} status.`);
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not test webhook');
    } finally {
      setTestingId(null);
    }
  };

  const retryDue = async () => {
    setRetrying(true);
    setMessage('');
    try {
      const page = await postJson<{ data: WebhookDelivery[] }>('/v1/webhooks/retry-due', {});
      setMessage(`Retried ${page.data.length} due webhook deliver${page.data.length === 1 ? 'y' : 'ies'}.`);
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not retry webhooks');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Webhooks</h1>
          <p>Persist callback subscriptions for session lifecycle, turn, and operations events. Test records a signed local delivery; Retry due dispatches queued retries.</p>
        </div>
        <div className="toolbarActions">
          <button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />Create webhook
          </button>
          <button className="secondaryButton" type="button" onClick={() => void retryDue()} disabled={retrying || data.webhooks.length === 0}>
            <Send size={16} /> {retrying ? 'Retrying...' : 'Retry due'}
          </button>
        </div>
      </div>
      <SummaryStrip items={[
        { label: 'Subscriptions', value: data.webhooks.length, icon: <RadioTower size={18} /> },
        { label: 'Active', value: data.webhooks.filter((item) => item.status === 'active').length, icon: <Activity size={18} /> },
        { label: 'Event bindings', value: data.webhooks.reduce((total, item) => total + item.events.length, 0), icon: <Send size={18} /> },
        { label: 'Retry mode', value: 'manual', icon: <Send size={18} /> },
      ]} />
      <OperationGuide items={[
        { icon: <RadioTower size={17} />, title: 'Define subscriptions', body: 'Create webhook records here, then keep delivery operations visible and safe from the same Console page.' },
        { icon: <Send size={17} />, title: 'Test delivery', body: 'Send a signed dry-run payload before wiring the endpoint into a real workflow.' },
        { icon: <Activity size={17} />, title: 'Retry queue', body: 'Process due retries from here while delivery history remains in the local runtime.' },
      ]} />
      <div className="tablePanel operationTablePanel">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>URL</th><th>Events</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead>
          <tbody>
            {data.webhooks.map((webhook) => (
              <tr key={webhook.id}>
                <td><code>{truncateMiddle(webhook.id, 18)}</code></td>
                <td><strong>{webhook.name}</strong></td>
                <td><span className="monoValue">{truncateMiddle(webhook.url, 42)}</span></td>
                <td><ResourceBadge>{webhook.events.length} events</ResourceBadge></td>
                <td><StatusPill status={webhook.status} /></td>
                <td>{formatDateShort(webhook.updated_at)}</td>
                <td>
                  <button className="ghostButton compactButton" type="button" onClick={() => testWebhook(webhook)} disabled={testingId === webhook.id || webhook.status !== 'active'}>
                    <Send size={14} /> {testingId === webhook.id ? 'Testing...' : 'Test'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.webhooks.length === 0 ? (
          <EmptyState
            icon={<RadioTower size={22} />}
            title="No webhooks"
            body="Create webhook subscriptions here, then test deliveries and retry due attempts from the same page."
            action={<button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} />Create webhook</button>}
          />
        ) : null}
      </div>
      <div className="mobileResourceList">
        {data.webhooks.map((webhook) => (
          <article className="mobileResourceCard" key={webhook.id}>
            <span className="mobileAgentMain">
              <strong>{webhook.name}</strong>
              <small className="monoText">{truncateMiddle(webhook.url, 42)}</small>
            </span>
            <span className="mobileAgentMeta">
              <ResourceBadge>{webhook.events.length} events</ResourceBadge>
              <StatusPill status={webhook.status} />
            </span>
            <button className="ghostButton compactButton" type="button" onClick={() => testWebhook(webhook)} disabled={testingId === webhook.id || webhook.status !== 'active'}>
              <Send size={14} /> {testingId === webhook.id ? 'Testing...' : 'Test'}
            </button>
          </article>
        ))}
        {data.webhooks.length === 0 ? (
          <EmptyState
            icon={<RadioTower size={22} />}
            title="No webhooks"
            body="Create webhook subscriptions here, then test deliveries and retry due attempts from the same page."
            action={<button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} />Create webhook</button>}
          />
        ) : null}
      </div>
      {message ? <OperationNotice>{message}</OperationNotice> : null}
      {createOpen ? (
        <WebhookCreateModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            onRefresh();
          }}
        />
      ) : null}
    </section>
  );
}

export function ScheduledDeploymentsPage({ data, onRefresh }: OperationsPageProps) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningDue, setRunningDue] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState('');

  const runSchedule = async (schedule: ScheduledDeployment) => {
    setRunningId(schedule.id);
    setMessage('');
    try {
      const run = await postJson<ScheduledDeploymentRun>(`/v1/scheduled-deployments/${schedule.id}/run`, {
        trigger_type: 'manual',
        payload: { title: `Manual run: ${schedule.name}` },
      });
      setMessage(`Run ${truncateMiddle(run.id, 18)} created${run.session_id ? ` session ${truncateMiddle(run.session_id, 18)}` : ''}.`);
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not run schedule');
    } finally {
      setRunningId(null);
    }
  };

  const runDueSchedules = async () => {
    setRunningDue(true);
    setMessage('');
    try {
      const page = await postJson<{ data: ScheduledDeploymentRun[] }>('/v1/scheduled-deployments/run-due', {});
      setMessage(`Ran ${page.data.length} due scheduled deployment${page.data.length === 1 ? '' : 's'}.`);
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not run due schedules');
    } finally {
      setRunningDue(false);
    }
  };

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Scheduled deployments</h1>
          <p>Persist cron-style run plans for agents and environments. Run due executes all active schedules whose next run has arrived.</p>
        </div>
        <div className="toolbarActions">
          <button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />Create schedule
          </button>
          <button className="secondaryButton" type="button" onClick={() => void runDueSchedules()} disabled={runningDue || data.scheduledDeployments.length === 0}>
            <Play size={16} /> {runningDue ? 'Running due...' : 'Run due'}
          </button>
        </div>
      </div>
      <SummaryStrip items={[
        { label: 'Schedules', value: data.scheduledDeployments.length, icon: <CalendarClock size={18} /> },
        { label: 'Active', value: data.scheduledDeployments.filter((item) => item.status === 'active').length, icon: <Activity size={18} /> },
        { label: 'Due candidates', value: data.scheduledDeployments.filter((item) => item.status === 'active' && item.next_run_at).length, icon: <Play size={18} /> },
        { label: 'Runner', value: 'manual', icon: <Play size={18} /> },
      ]} />
      <OperationGuide items={[
        { icon: <CalendarClock size={17} />, title: 'Cron plans', body: 'Schedules bind an agent, environment, payload, and next-run timestamp into a replayable plan.' },
        { icon: <Play size={17} />, title: 'Manual run', body: 'Run one schedule immediately without waiting for the due-run loop.' },
        { icon: <Activity size={17} />, title: 'Due-run sweep', body: 'Process every active schedule whose next run is ready, then refresh local state.' },
      ]} />
      <div className="tablePanel operationTablePanel">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Agent</th><th>Environment</th><th>Cron</th><th>Status</th><th>Next run</th><th>Action</th></tr></thead>
          <tbody>
            {data.scheduledDeployments.map((schedule) => (
              <tr key={schedule.id}>
                <td><code>{truncateMiddle(schedule.id, 18)}</code></td>
                <td><strong>{schedule.name}</strong></td>
                <td><code>{truncateMiddle(schedule.agent_id, 20)}</code></td>
                <td>{schedule.environment_id ? <code>{truncateMiddle(schedule.environment_id, 18)}</code> : <span className="mutedValue">default</span>}</td>
                <td><span className="monoValue">{schedule.cron}</span></td>
                <td><StatusPill status={schedule.status} /></td>
                <td>{schedule.next_run_at ? formatDateShort(schedule.next_run_at) : '-'}</td>
                <td>
                  <button className="ghostButton compactButton" type="button" onClick={() => runSchedule(schedule)} disabled={runningId === schedule.id || schedule.status !== 'active'}>
                    <Play size={14} /> {runningId === schedule.id ? 'Running...' : 'Run now'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.scheduledDeployments.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={22} />}
            title="No scheduled deployments"
            body="Create schedules here, then run one schedule or process all due runs from the same page."
            action={<button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} />Create schedule</button>}
          />
        ) : null}
      </div>
      <div className="mobileResourceList">
        {data.scheduledDeployments.map((schedule) => (
          <article className="mobileResourceCard" key={schedule.id}>
            <span className="mobileAgentMain">
              <strong>{schedule.name}</strong>
              <small className="monoText">{schedule.cron}</small>
            </span>
            <span className="mobileAgentMeta">
              <span>{schedule.next_run_at ? `Next ${formatDateShort(schedule.next_run_at)}` : 'No next run'}</span>
              <StatusPill status={schedule.status} />
            </span>
            <button className="ghostButton compactButton" type="button" onClick={() => runSchedule(schedule)} disabled={runningId === schedule.id || schedule.status !== 'active'}>
              <Play size={14} /> {runningId === schedule.id ? 'Running...' : 'Run now'}
            </button>
          </article>
        ))}
        {data.scheduledDeployments.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={22} />}
            title="No scheduled deployments"
            body="Create schedules here, then run one schedule or process all due runs from the same page."
            action={<button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} />Create schedule</button>}
          />
        ) : null}
      </div>
      {message ? <OperationNotice>{message}</OperationNotice> : null}
      {createOpen ? (
        <ScheduledDeploymentCreateModal
          data={data}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            onRefresh();
          }}
        />
      ) : null}
    </section>
  );
}

export function OutcomesPage({ data, onRefresh }: OperationsPageProps) {
  const latestSessionId = useMemo(() => data.sessions[0]?.id ?? '', [data.sessions]);
  const [selectedSessionId, setSelectedSessionId] = useState(latestSessionId);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!selectedSessionId && latestSessionId) setSelectedSessionId(latestSessionId);
  }, [latestSessionId, selectedSessionId]);

  const evaluateOutcome = async (outcome: Outcome) => {
    if (!selectedSessionId) {
      setMessage('Create a session before evaluating outcomes.');
      return;
    }
    setEvaluatingId(outcome.id);
    setMessage('');
    try {
      const result = await postJson<SessionOutcome>(`/v1/sessions/${selectedSessionId}/outcomes/evaluate`, {
        outcome_id: outcome.id,
      });
      setMessage(`Evaluation ${truncateMiddle(result.id, 18)}: ${result.status}${typeof result.score === 'number' ? ` (${Math.round(result.score * 100)}%)` : ''}.`);
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not evaluate outcome');
    } finally {
      setEvaluatingId(null);
    }
  };

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Outcomes</h1>
          <p>Define expected run outcomes and record session evaluations for deployment-quality feedback.</p>
        </div>
        <div className="toolbarActions">
          <button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />Create outcome
          </button>
          <SessionPicker sessions={data.sessions} selectedSessionId={selectedSessionId} onChange={setSelectedSessionId} />
        </div>
      </div>
      <SummaryStrip items={[
        { label: 'Definitions', value: data.outcomes.length, icon: <CheckCircle2 size={18} /> },
        { label: 'Active', value: data.outcomes.filter((item) => item.status === 'active').length, icon: <Activity size={18} /> },
        { label: 'Sessions available', value: data.sessions.length, icon: <Play size={18} /> },
        { label: 'Evaluator', value: 'deterministic', icon: <CheckCircle2 size={18} /> },
      ]} />
      <OperationGuide items={[
        { icon: <CheckCircle2 size={17} />, title: 'Define criteria', body: 'Outcome definitions capture objective, criteria, threshold, and evaluator policy.' },
        { icon: <Play size={17} />, title: 'Evaluate a run', body: 'Pick a real session, evaluate it against one definition, and record the result.' },
        { icon: <Activity size={17} />, title: 'Use as evidence', body: 'Treat session outcomes as deployment-quality evidence for FDE handoffs.' },
      ]} />
      <div className="tablePanel operationTablePanel">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Objective</th><th>Criteria</th><th>Threshold</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead>
          <tbody>
            {data.outcomes.map((outcome) => (
              <tr key={outcome.id}>
                <td><code>{truncateMiddle(outcome.id, 18)}</code></td>
                <td><strong>{outcome.name}</strong></td>
                <td>{outcome.objective}</td>
                <td><ResourceBadge>{outcome.criteria.length} criteria</ResourceBadge></td>
                <td><ResourceBadge>{Math.round((outcome.pass_threshold ?? 0.75) * 100)}% · {outcome.evaluator ?? 'deterministic'}</ResourceBadge></td>
                <td><StatusPill status={outcome.status} /></td>
                <td>{formatDateShort(outcome.updated_at)}</td>
                <td>
                  <button className="ghostButton compactButton" type="button" onClick={() => evaluateOutcome(outcome)} disabled={evaluatingId === outcome.id || outcome.status !== 'active' || !selectedSessionId}>
                    <CheckCircle2 size={14} /> {evaluatingId === outcome.id ? 'Evaluating...' : 'Evaluate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.outcomes.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={22} />}
            title="No outcomes"
            body="Create outcome definitions here; local deterministic evaluation is available after a definition exists."
            action={<button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} />Create outcome</button>}
          />
        ) : null}
      </div>
      <div className="mobileResourceList">
        {data.outcomes.map((outcome) => (
          <article className="mobileResourceCard" key={outcome.id}>
            <span className="mobileAgentMain">
              <strong>{outcome.name}</strong>
              <small>{outcome.objective}</small>
            </span>
            <span className="mobileAgentMeta">
              <ResourceBadge>{Math.round((outcome.pass_threshold ?? 0.75) * 100)}% · {outcome.evaluator ?? 'deterministic'}</ResourceBadge>
              <StatusPill status={outcome.status} />
            </span>
            <button className="ghostButton compactButton" type="button" onClick={() => evaluateOutcome(outcome)} disabled={evaluatingId === outcome.id || outcome.status !== 'active' || !selectedSessionId}>
              <CheckCircle2 size={14} /> {evaluatingId === outcome.id ? 'Evaluating...' : 'Evaluate'}
            </button>
          </article>
        ))}
        {data.outcomes.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={22} />}
            title="No outcomes"
            body="Create outcome definitions here; local deterministic evaluation is available after a definition exists."
            action={<button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} />Create outcome</button>}
          />
        ) : null}
      </div>
      {message ? <OperationNotice>{message}</OperationNotice> : null}
      {createOpen ? (
        <OutcomeCreateModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            onRefresh();
          }}
        />
      ) : null}
    </section>
  );
}

function WebhookCreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('turn_complete');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await postJson<Webhook>('/v1/webhooks', {
        name: name || undefined,
        url,
        description,
        events: splitLines(events),
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'Could not create webhook');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create webhook" onClose={onClose}>
      <form className="modalForm operationCreateForm" onSubmit={submit}>
        {error ? <div className="banner error">{error}</div> : null}
        <label>
          <span>Endpoint URL <RequiredMark /></span>
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/managed-agents/webhook" required />
        </label>
        <label>
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production callback" />
        </label>
        <label>
          <span>Events <RequiredMark /></span>
          <textarea value={events} onChange={(event) => setEvents(event.target.value)} rows={4} required />
          <small>One event per line, such as turn_complete or session.failed.</small>
        </label>
        <label>
          <span>Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
        <div className="modalActions">
          <button className="secondaryButton" type="button" onClick={onClose}>Cancel</button>
          <button className="primaryButton" type="submit" disabled={saving || !url.trim() || splitLines(events).length === 0}>{saving ? 'Creating...' : 'Create webhook'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ScheduledDeploymentCreateModal({ data, onClose, onSaved }: { data: ConsoleData; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState(data.agents[0]?.id ?? '');
  const [environmentId, setEnvironmentId] = useState(data.environments[0]?.id ?? '');
  const [cron, setCron] = useState('0 9 * * *');
  const [payloadText, setPayloadText] = useState('{\n  "title": "Scheduled run"\n}');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await postJson<ScheduledDeployment>('/v1/scheduled-deployments', {
        name,
        agent_id: agentId,
        environment_id: environmentId || undefined,
        cron,
        payload: parseJsonObject(payloadText),
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'Could not create schedule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create scheduled deployment" onClose={onClose}>
      <form className="modalForm operationCreateForm" onSubmit={submit}>
        {error ? <div className="banner error">{error}</div> : null}
        <label>
          <span>Name <RequiredMark /></span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Daily review run" required />
        </label>
        <label>
          <span>Agent <RequiredMark /></span>
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)} required>
            {data.agents.length === 0 ? <option value="">No agents available</option> : null}
            {data.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <label>
          <span>Environment</span>
          <select value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
            <option value="">Default</option>
            {data.environments.map((environment) => <option value={environment.id} key={environment.id}>{environment.name}</option>)}
          </select>
        </label>
        <label>
          <span>Cron <RequiredMark /></span>
          <input value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 9 * * *" required />
        </label>
        <label>
          <span>Payload JSON</span>
          <textarea value={payloadText} onChange={(event) => setPayloadText(event.target.value)} rows={5} spellCheck={false} />
        </label>
        <div className="modalActions">
          <button className="secondaryButton" type="button" onClick={onClose}>Cancel</button>
          <button className="primaryButton" type="submit" disabled={saving || !name.trim() || !agentId || !cron.trim()}>{saving ? 'Creating...' : 'Create schedule'}</button>
        </div>
      </form>
    </Modal>
  );
}

function OutcomeCreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [criteria, setCriteria] = useState('');
  const [threshold, setThreshold] = useState('0.8');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await postJson<Outcome>('/v1/outcomes', {
        name,
        objective,
        description,
        criteria: splitLines(criteria),
        pass_threshold: Number(threshold),
        evaluator: 'deterministic',
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'Could not create outcome');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create outcome" onClose={onClose}>
      <form className="modalForm operationCreateForm" onSubmit={submit}>
        {error ? <div className="banner error">{error}</div> : null}
        <label>
          <span>Name <RequiredMark /></span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Deployment-quality response" required />
        </label>
        <label>
          <span>Objective <RequiredMark /></span>
          <textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={3} required />
        </label>
        <label>
          <span>Criteria</span>
          <textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} rows={4} placeholder="One criterion per line" />
        </label>
        <label>
          <span>Pass threshold</span>
          <input value={threshold} onChange={(event) => setThreshold(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          <span>Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
        <div className="modalActions">
          <button className="secondaryButton" type="button" onClick={onClose}>Cancel</button>
          <button className="primaryButton" type="submit" disabled={saving || !name.trim() || !objective.trim()}>{saving ? 'Creating...' : 'Create outcome'}</button>
        </div>
      </form>
    </Modal>
  );
}

function OperationNotice({ children }: { children: ReactNode }) {
  return (
    <div className="operationNotice" role="status">
      {children}
    </div>
  );
}

function OperationGuide({ items }: { items: Array<{ icon: ReactNode; title: string; body: string }> }) {
  return (
    <div className="operationGuideGrid">
      {items.map((item) => (
        <article className="operationGuideCard" key={item.title}>
          <span>{item.icon}</span>
          <div>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function SessionPicker({ sessions, selectedSessionId, onChange }: { sessions: Session[]; selectedSessionId: string; onChange: (value: string) => void }) {
  return (
    <label className="inlineSelectControl">
      <span>Evaluate session</span>
      <select value={selectedSessionId} onChange={(event) => onChange(event.target.value)} disabled={sessions.length === 0}>
        {sessions.length === 0 ? <option value="">No sessions</option> : null}
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {session.title || truncateMiddle(session.id, 18)}
          </option>
        ))}
      </select>
    </label>
  );
}

function splitLines(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function parseJsonObject(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON payload must be an object');
  }
  return parsed;
}
