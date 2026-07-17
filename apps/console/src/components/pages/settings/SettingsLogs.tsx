import { Activity, Database, FileText, Gauge, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getPage, postJson } from '../../../api';
import { SummaryStrip } from '../../Common';
import { pathName } from '../../../lib/format';
import type { ConsoleData, RuntimeLogEntry, RuntimeLogLevel } from '../../../types';

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
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : String(err));
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
    } catch (err) {
      setRestartStatus(err instanceof Error ? err.message : String(err));
      setRestarting(false);
    }
  };

  return (
    <section className="stack settingsLogsPage">
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
          <div className="emptyValue">{logsLoading ? 'Loading logs...' : 'No runtime logs captured yet'}</div>
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
