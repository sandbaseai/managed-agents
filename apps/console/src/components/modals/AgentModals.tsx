import { ChevronDown, FileText } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { postJson, putJson } from '../../api';
import { CodeEditor } from '../CodeEditor';
import { Modal } from '../Modal';
import type { Agent, AgentToolset, ConsoleData, SkillRef, Template } from '../../types';

type AgentConfigFormat = 'yaml' | 'json';

export function AgentModal({ template, data, onClose, onSaved }: { template?: Template; data: ConsoleData; onClose: () => void; onSaved: () => void }) {
  const initialTemplate = template ?? data.templates[0];
  const [selected, setSelected] = useState<Template | undefined>(initialTemplate);
  const [format, setFormat] = useState<AgentConfigFormat>('yaml');
  const [configText, setConfigText] = useState(formatAgentDefinition(initialTemplate?.agent ?? defaultAgentDraft(data), 'yaml'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const chooseTemplate = (next: Template) => {
    setSelected(next);
    setConfigText(formatAgentDefinition(next.agent, format));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await postJson('/v1/agents', parseAgentConfig(configText, format));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create agent" subtitle="Start from a template and edit the YAML config." onClose={onClose} size="wide">
      <form className="agentComposer" onSubmit={submit}>
        {error ? <div className="banner error inlineBanner">{error}</div> : null}
        <section className="composerSection">
          <div className="sectionTitle"><ChevronDown size={18} /><strong>Starting point</strong>{selected ? <span>· {selected.name}</span> : null}</div>
          <div className="claudeTemplateGrid">
            {data.templates.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`claudeTemplateCard ${selected?.id === item.id ? 'selected' : ''}`}
                onClick={() => chooseTemplate(item)}
              >
                <strong>{item.name}</strong>
                <span>{item.description}</span>
                {item.tags.length ? <small>{item.tags.slice(0, 4).join(' · ')}</small> : null}
              </button>
            ))}
          </div>
        </section>

        <section className="composerSection">
          <h2>Agent config</h2>
          <AgentConfigEditor
            value={configText}
            format={format}
            onChange={setConfigText}
            onFormat={(next) => convertConfigFormat({ value: configText, format, next, setValue: setConfigText, setFormat, setError })}
            minRows={18}
          />
        </section>

        <div className="modalActions stickyActions">
          <button className="darkButton" type="submit" disabled={saving}>Create agent</button>
        </div>
      </form>
    </Modal>
  );
}

export function AgentEditModal({ agent, onClose, onSaved }: { agent: Agent; onClose: () => void; onSaved: () => void }) {
  const [format, setFormat] = useState<AgentConfigFormat>('yaml');
  const [configText, setConfigText] = useState(formatAgentDefinition(agentDraftFromApi(agent), 'yaml'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await putJson(`/v1/agents/${agent.id}`, parseAgentConfig(configText, format));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit agent" onClose={onClose} size="medium">
      <form className="agentComposer" onSubmit={submit}>
        {error ? <div className="banner error inlineBanner">{error}</div> : null}
        <AgentConfigEditor
          value={configText}
          format={format}
          onChange={setConfigText}
          onFormat={(next) => convertConfigFormat({ value: configText, format, next, setValue: setConfigText, setFormat, setError })}
          minRows={16}
        />
        <div className="modalActions stickyActions">
          <button className="darkButton" type="submit" disabled={saving}>Save new version</button>
        </div>
      </form>
    </Modal>
  );
}

type AgentDraft = {
  name: string;
  description?: string;
  model: string;
  model_config?: { speed: string };
  system: string;
  mcp_servers?: Array<Record<string, unknown>>;
  tools?: AgentToolset[];
  skills?: SkillRef[];
  metadata?: Record<string, unknown>;
};

function AgentConfigEditor({
  value,
  format,
  onChange,
  onFormat,
  minRows,
}: {
  value: string;
  format: AgentConfigFormat;
  onChange: (value: string) => void;
  onFormat: (format: AgentConfigFormat) => void;
  minRows: number;
}) {
  return (
    <div className="yamlShell">
      <div className="yamlToolbar">
        <label>
          <span className="srOnly">Agent config format</span>
          <select value={format} onChange={(event) => onFormat(event.target.value as AgentConfigFormat)}>
            <option value="yaml">YAML</option>
            <option value="json">JSON</option>
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </label>
        <FileText size={17} />
      </div>
      <CodeEditor value={value} onChange={onChange} language={format} minRows={minRows} />
    </div>
  );
}

function defaultAgentDraft(data: ConsoleData): AgentDraft {
  return {
    name: 'Untitled agent',
    description: 'A blank starting point with the core toolset.',
    model: data.runtime?.models[0]?.name ?? 'claude-sonnet-5',
    system: 'You are a general-purpose agent that can research, write code, run commands, and use connected tools to complete the user\'s task end to end.',
    mcp_servers: [],
    tools: [{ type: 'agent_toolset_20260401' }],
    skills: [],
    metadata: {},
  };
}

function agentDraftFromApi(agent: Agent): AgentDraft {
  return {
    name: agent.name,
    model: agent.model,
    model_config: agent.model_config,
    description: agent.description,
    system: agent.system,
    mcp_servers: agent.mcp_servers,
    tools: agent.tools,
    skills: agent.skills,
    metadata: agent.metadata ?? {},
  };
}

function agentDefinitionObject(agent: AgentDraft): AgentDraft {
  return {
    name: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    model: agent.model,
    ...(agent.model_config && agent.model_config.speed !== 'standard' ? { model_config: agent.model_config } : {}),
    system: agent.system,
    mcp_servers: agent.mcp_servers ?? [],
    tools: agent.tools ?? [{ type: 'agent_toolset_20260401' }],
    skills: agent.skills ?? [],
    metadata: agent.metadata ?? {},
  };
}

function agentDefinitionYaml(agent: AgentDraft): string {
  return stringifyYaml(agentDefinitionObject(agent), { blockQuote: 'literal', lineWidth: 100 });
}

function agentDefinitionJson(agent: AgentDraft): string {
  return `${JSON.stringify(agentDefinitionObject(agent), null, 2)}\n`;
}

function formatAgentDefinition(agent: AgentDraft, format: AgentConfigFormat): string {
  return format === 'json' ? agentDefinitionJson(agent) : agentDefinitionYaml(agent);
}

function parseAgentConfig(value: string, format: AgentConfigFormat): AgentDraft {
  return format === 'json' ? JSON.parse(value) : parseYaml(value);
}

function stringifyAgentConfig(value: AgentDraft, format: AgentConfigFormat): string {
  return format === 'json' ? `${JSON.stringify(value, null, 2)}\n` : stringifyYaml(value, { blockQuote: 'literal', lineWidth: 100 });
}

function convertConfigFormat({
  value,
  format,
  next,
  setValue,
  setFormat,
  setError,
}: {
  value: string;
  format: AgentConfigFormat;
  next: AgentConfigFormat;
  setValue: (value: string) => void;
  setFormat: (format: AgentConfigFormat) => void;
  setError: (error: string) => void;
}) {
  if (format === next) return;

  try {
    const parsed = parseAgentConfig(value, format);
    setValue(stringifyAgentConfig(parsed, next));
    setFormat(next);
    setError('');
  } catch (err) {
    setError(`Cannot switch to ${next.toUpperCase()}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
