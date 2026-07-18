import { X } from 'lucide-react';
import { MetricCard } from '../Common';
import { formatDateShort, relativeDate, shortId, titleCase } from '../../lib/format';
import type { Environment, Session } from '../../types';
import {
  environmentKeys,
  environmentMetadataEntries,
  environmentNetwork,
  environmentPackages,
} from './EnvironmentPageModel';

export function CloudEnvironment({ environment }: { environment: Environment }) {
  const network = environmentNetwork(environment);
  const packages = environmentPackages(environment);
  const metadata = environmentMetadataEntries(environment);
  return (
    <div className="environmentBody">
      <section className="environmentSection">
        <h2>Networking</h2>
        <p>Configure network access policies for this environment.</p>
        <div className="readonlyFields">
          <ReadonlyField label="Type" value={titleCase(network.type)} />
          <ReadonlyField label="Allow MCP server network access" value={network.allowMcp ? 'Enabled' : 'Disabled'} />
          <ReadonlyField label="Allow package manager network access" value={network.allowPackageManager ? 'Enabled' : 'Disabled'} />
          <ReadonlyField label="Allowed hosts" value={network.allowedHosts.length ? network.allowedHosts.join(', ') : 'None provided'} wide />
        </div>
      </section>
      <section className="environmentSection">
        <h2>Packages</h2>
        <p>Specify packages and their versions available in this environment. Separate multiple values with spaces.</p>
        <ReadonlyTable
          empty="No packages configured"
          rows={packages.map((item) => [item.manager, item.package])}
          columns={['Manager', 'Package']}
        />
      </section>
      <section className="environmentSection">
        <h2>Metadata</h2>
        <p>Add custom key-value pairs to tag and organize this environment. Keys must be lowercase.</p>
        <ReadonlyTable
          empty="No metadata"
          rows={metadata}
          columns={['Key', 'Value']}
        />
      </section>
    </div>
  );
}

export function SelfHostedEnvironment({ environment, sessions }: { environment: Environment; sessions: Session[] }) {
  const keys = environmentKeys(environment);
  const idleSessions = sessions.filter((session) => session.status === 'idle');
  const runningSessions = sessions.filter((session) => session.status === 'running');
  const completedSessions = sessions.filter((session) => session.status === 'terminated');
  const oldestActiveSession = [...idleSessions, ...runningSessions].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return (
    <div className="environmentBody">
      <section className="environmentSection">
        <h2>Overview</h2>
        <p>Live session activity for this self-hosted environment. Updates every few seconds.</p>
        <div className="metricGrid compactMetrics">
          <MetricCard title="Idle sessions" value={idleSessions.length} />
          <MetricCard title="Running sessions" value={runningSessions.length} />
          <MetricCard title="Completed sessions" value={completedSessions.length} />
          <MetricCard title="Oldest active session" value={oldestActiveSession ? relativeDate(oldestActiveSession.created_at) : 'None'} />
        </div>
      </section>
      <div className="selfHostedGrid">
        <section className="environmentSection">
          <h2>Environment keys</h2>
          <p>An environment key lets a runner on your infrastructure connect to this environment and pull jobs. Generate one per host so you can revoke access individually.</p>
          <ReadonlyTable
            empty="No environment keys"
            rows={keys.map((key) => [key.name, shortId(key.id), formatDateShort(key.created_at), formatDateShort(key.expires_at)])}
            columns={['Name', 'ID', 'Created', 'Expires at']}
          />
        </section>
        <section className="setupCard">
          <div className="setupHeader">
            <h2>Set up your self-hosted environment</h2>
            <button className="iconButton quiet" type="button" title="Dismiss setup"><X size={18} /></button>
          </div>
          <p>These instructions guide you through a low-code CLI worker setup. Additional options are also available in public documentation.</p>
          <SetupStep index={1} title="Register an environment key" body="Generate an environment key authenticating your infrastructure with this environment." />
          <SetupStep index={2} title="Export environment key as env var" body="This authorizes the environment worker to pull for work." code={`export MANAGED_AGENTS_ENVIRONMENT_KEY='env-key-...'`} />
          <SetupStep index={3} title="Install managed-agents CLI" body="Run this command on the machine where you want the environment worker to run." code={`npm install -g managed-agents`} />
          <SetupStep index={4} title="Invoke the worker" body="Poll for jobs and execute them locally." code={`managed-agents worker poll \\\n  --environment-id "${environment.id}" \\\n  --workdir "/workspace"`} />
        </section>
      </div>
    </div>
  );
}

export function ReadonlyTable({ columns, rows, empty }: { columns: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="readonlyTable">
      {rows.length === 0 ? <div className="emptyValue">{empty}</div> : (
        <table>
          <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.join('-')}-${index}`}>
                {row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReadonlyField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`readonlyField ${wide ? 'wide' : ''}`}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function SetupStep({ index, title, body, code }: { index: number; title: string; body: string; code?: string }) {
  return (
    <div className="setupStep">
      <span>{index}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        {code ? <pre>{code}</pre> : null}
      </div>
    </div>
  );
}
