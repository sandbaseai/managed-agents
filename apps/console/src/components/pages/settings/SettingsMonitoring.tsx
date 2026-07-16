import { Activity, CirclePlay, Gauge, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getText } from '../../../api';
import type { ConsoleData } from '../../../types';
import { KeyValuePanel, SummaryStrip } from '../../Common';

type ParsedMetrics = {
  disabled: boolean;
  httpRequests?: number;
  httpErrors?: number;
  httpRequestDurationCount?: number;
  httpRequestDurationSum: number;
};

export function SettingsMonitoring({ data }: { data: ConsoleData }) {
  const [metricsText, setMetricsText] = useState('');
  const [metricsError, setMetricsError] = useState('');

  useEffect(() => {
    let mounted = true;
    getText('/v1/x/metrics')
      .then((text) => {
        if (!mounted) return;
        setMetricsText(text);
        setMetricsError('');
      })
      .catch((error: Error) => {
        if (!mounted) return;
        setMetricsText('');
        setMetricsError(error.message);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const tokenTotal = data.sessions.reduce((sum, session) => sum + session.usage.input_tokens + session.usage.output_tokens, 0);
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
      </div>
      <SummaryStrip items={[
        { label: 'Sessions', value: data.sessions.length, icon: <MessageSquare size={18} /> },
        { label: 'Running', value: data.sessions.filter((session) => session.status === 'running').length, icon: <CirclePlay size={18} /> },
        { label: 'HTTP requests', value: requestCount, icon: <Activity size={18} /> },
        { label: 'HTTP errors', value: errorCount, icon: <Gauge size={18} /> },
      ]} />
      <div className="workspaceGrid">
        <div className="panel subtlePanel">
          <h2>Runtime metrics</h2>
          <p>Live process counters from <code>/v1/x/metrics</code>.</p>
          <KeyValuePanel rows={[
            ['Metrics status', metricsStatus],
            ['Request samples', requestSamples],
            ['Average request duration', averageDuration],
            ['Session tokens', tokenTotal],
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
