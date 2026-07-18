import { Box, Brain, Copy, Info, Layers, Monitor, Zap } from 'lucide-react';
import { copyText, pathName, relativeWorkspacePath, workspaceConfigDir } from '../../../lib/format';
import type { ConsoleData, Workspace } from '../../../types';
import { KeyValuePanel, SummaryStrip } from '../../Common';

export function WorkspacePathsPanel({ workspace }: { workspace: Workspace | null }) {
  const configDir = workspaceConfigDir(workspace);
  const directoryRows = [
    { label: 'Agent seed directory', path: workspace?.directories?.agents ?? workspace?.agentsDir, defaultLabel: 'agents/', kind: 'directory' as const },
    { label: 'Skill seed directory', path: workspace?.directories?.skills ?? workspace?.skillsDir, defaultLabel: 'skills/', kind: 'directory' as const },
    { label: 'Runtime data directory', path: workspace?.directories?.data ?? workspace?.dataDir, defaultLabel: '~/.managed-agents/<workspace>/', kind: 'directory' as const },
    { label: 'Config file', path: workspace?.directories?.config ?? workspace?.configPath, defaultLabel: 'managed-agents.config.yaml', kind: 'file' as const },
  ];

  return (
    <div className="configFolderPanel">
      <div className="configFolderHeader">
        <div className="configFolderIcon"><Box size={20} /></div>
        <div>
          <span>Configuration folder</span>
          <strong title={configDir}>{pathName(configDir) || workspace?.name || 'workspace'}</strong>
        </div>
        {configDir ? (
          <button className="iconButton quiet" type="button" title={configDir} onClick={() => copyText(configDir)}>
            <Copy size={16} />
          </button>
        ) : null}
      </div>
      <div className="configPathList">
        {directoryRows.map((row) => (
          <div className="configPathRow" key={row.label} title={row.path ?? undefined}>
            <span>{row.label}</span>
            <strong>{relativeWorkspacePath(row.path, configDir, row.kind) ?? row.defaultLabel}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsWorkspace({ data }: { data: ConsoleData }) {
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Workspace</h1>
          <p>Manage the local workspace that backs this console.</p>
        </div>
      </div>
      <div className="workspaceNotice">
        <Info size={18} />
        <div>
          <strong>Single local workspace mode</strong>
          <span>Start the server with another root or config directory to run a different workspace.</span>
        </div>
      </div>
      <SummaryStrip
        items={[
          { label: 'Target', value: data.workspace?.target ?? 'local', icon: <Layers size={18} /> },
          { label: 'Agents', value: data.agents.length, icon: <Monitor size={18} /> },
          { label: 'Skills', value: data.skills.length, icon: <Zap size={18} /> },
          { label: 'Memory stores', value: data.memoryStores.length, icon: <Brain size={18} /> },
        ]}
      />
      <div className="workspaceGrid">
        <div className="panel subtlePanel">
          <h2>Current workspace</h2>
          <p>{data.workspace?.name ?? 'local workspace'}</p>
          <KeyValuePanel rows={[
            ['Target', data.workspace?.target],
            ['Mode', data.runtime ? 'Runtime connected' : 'Runtime starting'],
            ['Root folder', pathName(data.workspace?.root) || data.workspace?.name],
          ]} />
        </div>
        <div className="panel subtlePanel">
          <h2>Configuration</h2>
          <p>Local files used by the runtime.</p>
          <WorkspacePathsPanel workspace={data.workspace} />
        </div>
      </div>
    </section>
  );
}
