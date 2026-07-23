import { useEffect, useState } from 'react';
import { Activity, CirclePlay, Database, FileText, Gauge, MessageSquare, RefreshCw } from 'lucide-react';
import { getJson, getPage, getText, postJson } from '../../../api';
import { formatBytes, pathName } from '../../../lib/format';
import type { ConsoleData, RuntimeLogEntry, RuntimeLogLevel, RuntimeMetricsSummary } from '../../../types';
import { EmptyState, KeyValuePanel, SummaryStrip } from '../../Common';

export function SettingsLogs({ data }: { data: ConsoleData }) {
  const [logs, setLogs] = useState<RuntimeLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [logLevel, setLogLevel] = useState<RuntimeLogLevel | 'all'>('all');
  const [restartStatus, setRestartStatus] = useState('');
  const [restarting, setRestarting] = useState(false);

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (logLevel !== 'all') params.set('level', logLevel);
      const page = await getPage<RuntimeLogEntry>(`/v1/x/logs?${params.toString()}`);
      setLogs(page.data);
      setLogsError('');
    } catch (err: any) {
      setLogsError(err?.message ?? String(err));
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
    const timer = window.setInterval(() => void loadLogs(), 5000);
    return () => window.clearInterval(timer);
  }, [logLevel]);

  const restartRuntime = async () => {
    if (!window.confirm('Restart the runtime? Active sessions will be interrupted.')) return;
    setRestarting(true);
    setRestartStatus('Scheduling runtime restart...');
    try {
      await postJson<{ restarting: boolean; status: string }>('/v1/x/restart', {});
      setRestartStatus('Restart scheduled. The dashboard will reconnect when the runtime is back.');
    } catch (err: any) {
      setRestartStatus(err?.message ?? String(err));
      setRestarting(false);
    }
  };

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Logs</h1>
          <p>View recent runtime logs and restart the local process when needed.</p>
        </div>
        <div className="topActions">
          <button className="secondaryButton" type="button" onClick={() => void loadLogs()} disabled={logsLoading}>
            <RefreshCw size={16} />
            Refresh logs
          </button>
          <button className="primaryButton" type="button" onClick={() => void restartRuntime()} disabled={restarting}>
            <RefreshCw size={16} />
            Restart runtime
          </button>
        </div>
      </div>
      <SummaryStrip items={[
        { label: 'Runtime', value: data.runtime?.status ?? 'starting', icon: <Gauge size={18} /> },
        { label: 'Log lines', value: logs.length, icon: <FileText size={18} /> },
        { label: 'Errors', value: logs.filter((entry) => entry.level === 'error').length, icon: <Activity size={18} /> },
        { label: 'Data directory', value: pathName(data.workspace?.dataDir) || 'managed-agents', icon: <Database size={18} /> },
      ]} />
      <div className="resourceTruthStrip" aria-label="Logs truth model">
        <div><span>Diagnostics</span><strong>Logs are live process diagnostics, not persisted audit history.</strong></div>
        <div><span>Restart</span><strong>Restart is local runtime control and may interrupt active sessions.</strong></div>
        <div><span>Filtering</span><strong>Level filters only change the visible stream; they do not mutate runtime state.</strong></div>
      </div>
      <div className="sectionHeaderRow">
        <div>
          <h2>Runtime logs</h2>
          <p>Recent structured logs from the current runtime process.</p>
        </div>
        <div className="toolbarActions">
          <select
            className="compactSelect"
            value={logLevel}
            onChange={(event) => setLogLevel(event.target.value as RuntimeLogLevel | 'all')}
            aria-label="Log level"
          >
            <option value="all">All levels</option>
            <option value="debug">Debug and above</option>
            <option value="info">Info and above</option>
            <option value="warn">Warn and above</option>
            <option value="error">Errors only</option>
          </select>
          <button className="iconButton" type="button" title="Refresh logs" onClick={() => void loadLogs()} disabled={logsLoading}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="runtimeLogPanel">
        {restartStatus ? <div className="runtimeStatus">{restartStatus}</div> : null}
        {logsError ? <div className="runtimeStatus error">{logsError}</div> : null}
        {logs.length === 0 ? (
          <EmptyState
            icon={<FileText size={22} />}
            title={logsLoading ? 'Loading logs' : 'No runtime logs'}
            body={logsLoading ? 'Fetching recent structured log entries from the local runtime.' : 'No log entries have been captured for this filter yet.'}
          />
        ) : (
          <div className="runtimeLogList" role="log" aria-live="polite">
            {logs.map((entry, index) => (
              <div className={`runtimeLogLine ${entry.level}`} key={`${entry.time}-${index}`}>
                <span className="runtimeLogMeta">{formatRuntimeLogTime(entry.time)} {entry.level.toUpperCase()}</span>
                <span className="runtimeLogMessage">{formatRuntimeLog(entry)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function Observability({ data }: { data: ConsoleData }) {
  const [metricsText, setMetricsText] = useState('');
  const [metricsError, setMetricsError] = useState('');
  const [summary, setSummary] = useState<RuntimeMetricsSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [metricsLoading, setMetricsLoading] = useState(false);

  const loadMetrics = async () => {
    setMetricsLoading(true);
    const [metricsResult, summaryResult] = await Promise.allSettled([
      getText('/v1/x/metrics'),
      getJson<RuntimeMetricsSummary>('/v1/x/metrics/summary'),
    ]);
    if (metricsResult.status === 'fulfilled') {
      setMetricsText(metricsResult.value);
      setMetricsError('');
    } else {
      setMetricsText('');
      setMetricsError(metricsResult.reason instanceof Error ? metricsResult.reason.message : String(metricsResult.reason));
    }
    if (summaryResult.status === 'fulfilled') {
      setSummary(summaryResult.value);
      setSummaryError('');
    } else {
      setSummary(null);
      setSummaryError(summaryResult.reason instanceof Error ? summaryResult.reason.message : String(summaryResult.reason));
    }
    setMetricsLoading(false);
  };

  useEffect(() => {
    void loadMetrics();
  }, []);

  const tokenTotal = summary
    ? summary.sessions.input_tokens + summary.sessions.output_tokens
    : data.sessions.reduce((sum, session) => sum + session.usage.input_tokens + session.usage.output_tokens, 0);
  const metrics = parsePrometheusMetrics(metricsText);
  const averageRequestMs = metrics.httpRequestDurationCount
    ? Math.round(metrics.httpRequestDurationSum / metrics.httpRequestDurationCount)
    : null;
  const metricsStatus = metricsError || (metricsText ? (metrics.disabled ? 'disabled' : 'enabled') : 'loading');
  const requestCount = metrics.disabled ? 'disabled' : (metrics.httpRequests ?? 0);
  const errorCount = metrics.disabled ? 'disabled' : (metrics.httpErrors ?? 0);
  const requestSamples = metrics.disabled ? 'disabled' : (metrics.httpRequestDurationCount ?? 0);
  const averageDuration = metrics.disabled ? 'disabled' : (averageRequestMs === null ? 'No samples yet' : `${averageRequestMs} ms`);

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Monitoring</h1>
          <p>Inspect live runtime counters and session activity for this workspace.</p>
        </div>
        <button className="secondaryButton" type="button" onClick={() => void loadMetrics()} disabled={metricsLoading}>
          <RefreshCw size={16} />
          {metricsLoading ? 'Refreshing...' : 'Refresh metrics'}
        </button>
      </div>
      <SummaryStrip items={[
        { label: 'Sessions', value: summary?.sessions.total ?? data.sessions.length, icon: <MessageSquare size={18} /> },
        { label: 'Running', value: summary?.sessions.by_status.running ?? data.sessions.filter((session) => session.status === 'running').length, icon: <CirclePlay size={18} /> },
        { label: 'HTTP requests', value: summary?.http.requests ?? requestCount, icon: <Activity size={18} /> },
        { label: 'HTTP errors', value: summary?.http.errors ?? errorCount, icon: <Gauge size={18} /> },
      ]} />
      <div className="resourceTruthStrip" aria-label="Monitoring truth model">
        <div><span>Metrics</span><strong>Prometheus text is read directly from the local runtime endpoint.</strong></div>
        <div><span>Summary</span><strong>JSON counters aggregate sessions, events, storage, queue, and HTTP activity.</strong></div>
        <div><span>Configuration</span><strong>Monitoring is read-only; provider and storage changes live in runtime Settings.</strong></div>
      </div>
      <div className="workspaceGrid">
        <div className="panel subtlePanel">
          <h2>Runtime summary</h2>
          <p>Live JSON summary from <code>/v1/x/metrics/summary</code>.</p>
          <KeyValuePanel rows={[
            ['Metrics status', summaryError || metricsStatus],
            ['Events', summary?.events.total ?? requestSamples],
            ['Average event duration', summary ? `${summary.events.average_duration_ms} ms` : averageDuration],
            ['Session tokens', tokenTotal],
            ['Artifact bytes', summary ? formatBytes(summary.storage.artifact_bytes) : 'not loaded'],
            ['Worker queue', summary ? formatStatusCounts(summary.work_queue) : 'not loaded'],
          ]} />
        </div>
        <div className="panel subtlePanel">
          <h2>Prometheus endpoint</h2>
          <p>Raw text returned by the local runtime.</p>
          <pre className="metricsPreview">{metricsError || metricsText || '# metrics not loaded yet'}</pre>
        </div>
      </div>
    </section>
  );
}

type ParsedMetrics = {
  disabled: boolean;
  httpRequests?: number;
  httpErrors?: number;
  httpRequestDurationCount?: number;
  httpRequestDurationSum: number;
};

function parsePrometheusMetrics(text: string): ParsedMetrics {
  const disabled = text.trim() === '# metrics disabled';
  return {
    disabled,
    httpRequests: readPrometheusMetric(text, 'http_requests_total'),
    httpErrors: readPrometheusMetric(text, 'http_errors_total'),
    httpRequestDurationCount: readPrometheusMetric(text, 'http_request_duration_ms_count'),
    httpRequestDurationSum: readPrometheusMetric(text, 'http_request_duration_ms_sum') ?? 0,
  };
}

function readPrometheusMetric(text: string, name: string): number | undefined {
  const line = text.split('\n').find((item) => item.startsWith(`${name} `));
  if (!line) return undefined;
  const value = Number(line.split(/\s+/)[1]);
  return Number.isFinite(value) ? value : undefined;
}

function formatStatusCounts(counts: Record<string, number>) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  return entries.length > 0 ? entries.map(([status, count]) => `${status}: ${count}`).join(', ') : 'empty';
}

function formatRuntimeLogTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRuntimeLog(entry: RuntimeLogEntry) {
  const extras = Object.entries(entry)
    .filter(([key]) => !['level', 'time', 'msg', 'line'].includes(key))
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${formatRuntimeLogValue(value)}`);
  return extras.length > 0 ? `${entry.msg} ${extras.join(' ')}` : entry.msg;
}

function formatRuntimeLogValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
