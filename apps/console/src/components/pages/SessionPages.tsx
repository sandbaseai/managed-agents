import {
  Archive,
  ChevronDown,
  Clock,
  Cloud,
  Copy,
  Download,
  FileText,
  MessageSquare,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Send,
  Square,
  X,
} from 'lucide-react';
import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useState } from 'react';
import { deleteJson, getPage, postJson } from '../../api';
import { EmptyState, FilterSelect, LoadingState, ResourceBadge, StatusPill, SummaryStrip, Toolbar } from '../Common';
import { downloadJson, formatBytes, formatDateShort, formatDuration, formatUsage, relativeDate, shortId, titleCase, truncateMiddle } from '../../lib/format';
import type { Agent, ConsoleData, Page, Session, SessionEvent, WorkspaceFile } from '../../types';

const SESSION_EVENT_KINDS = ['user', 'agent', 'tool', 'error', 'system'] as const;
type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];

export function Sessions({ data, onNewSession, onOpenSession }: { data: ConsoleData; onNewSession: () => void; onOpenSession: (session: Session) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [agentId, setAgentId] = useState('all');
  const sessions = data.sessions.filter((session) => {
    const q = query.toLowerCase();
    const matchesStatus = status === 'all' || (status === 'active' ? !session.archived_at : session.status === status);
    const matchesAgent = agentId === 'all' || session.agent.id === agentId;
    const matchesQuery = session.id.toLowerCase().includes(q) || session.agent.name.toLowerCase().includes(q) || (session.title ?? '').toLowerCase().includes(q);
    return matchesStatus && matchesAgent && matchesQuery;
  });
  const running = data.sessions.filter((session) => session.status === 'running').length;
  const failed = data.sessions.filter((session) => session.status === 'failed').length;
  const terminated = data.sessions.filter((session) => session.status === 'terminated').length;
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Sessions</h1>
          <p>Replay agent runs, inspect events, approve tools, and capture artifacts.</p>
        </div>
        <button className="primaryButton" type="button" onClick={onNewSession}>
          <Plus size={18} />
          Create session
        </button>
      </div>
      <SummaryStrip items={[
        { label: 'Sessions', value: data.sessions.length, icon: <MessageSquare size={18} /> },
        { label: 'Running', value: running, icon: <RefreshCw size={18} /> },
        { label: 'Terminated', value: terminated, icon: <Square size={18} /> },
        { label: 'Failed', value: failed, icon: <Archive size={18} /> },
      ]} />
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by session ID"
        actions={(
          <>
            <FilterSelect
              label="Agent"
              value={agentId}
              onChange={setAgentId}
              options={[
                { value: 'all', label: 'All' },
                ...data.agents.map((agent) => ({ value: agent.id, label: agent.name })),
              ]}
            />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'all', label: 'All' },
                { value: 'idle', label: 'Idle' },
                { value: 'running', label: 'Running' },
                { value: 'failed', label: 'Failed' },
                { value: 'terminated', label: 'Terminated' },
              ]}
            />
          </>
        )}
      />
      <div className="tablePanel sessionsTablePanel">
        <table className="sessionTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Agent</th>
              <th>Tokens in / out</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} className="clickableRow" onClick={() => onOpenSession(session)}>
                <td>
                  <strong className="monoText">{shortId(session.id)}</strong>
                </td>
                <td>{session.title || '-'}</td>
                <td><StatusPill status={session.status} /></td>
                <td><ResourceBadge icon={<Monitor size={15} />} label={session.agent.name} /></td>
                <td>{formatUsage(session.usage)}</td>
                <td>{formatDateShort(session.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sessions.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={22} />}
            title="No sessions"
            body="Create a session to run an agent, inspect events, approve tools, and capture artifacts."
            action={<button className="primaryButton" type="button" onClick={onNewSession}><Plus size={16} />Create session</button>}
          />
        ) : null}
      </div>
      <div className="mobileSessionList">
        {sessions.map((session) => (
          <button className="mobileAgentCard" type="button" key={session.id} onClick={() => onOpenSession(session)}>
            <span className="mobileAgentMain">
              <strong>{session.title || session.id}</strong>
              <small className="monoText">{session.id}</small>
            </span>
            <span className="mobileAgentMeta">
              <span>{session.agent.name}</span>
              <StatusPill status={session.status} />
            </span>
          </button>
        ))}
        {sessions.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={22} />}
            title="No sessions"
            body="Create a session to run an agent, inspect events, approve tools, and capture artifacts."
            action={<button className="primaryButton" type="button" onClick={onNewSession}><Plus size={16} />Create session</button>}
          />
        ) : null}
      </div>
    </section>
  );
}

export function SessionDetail({
  session,
  data,
  onBack,
  onRefresh,
  onOpenAgent,
}: {
  session: Session;
  data: ConsoleData;
  onBack: () => void;
  onRefresh: () => void;
  onOpenAgent: (agent: Agent) => void;
}) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventError, setEventError] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mode, setMode] = useState<'transcript' | 'debug'>('transcript');
  const [detailMode, setDetailMode] = useState<'rendered' | 'raw'>('rendered');
  const [filterOpen, setFilterOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [selectedKinds, setSelectedKinds] = useState<Set<SessionEventKind>>(new Set(SESSION_EVENT_KINDS));
  const [query, setQuery] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [messageError, setMessageError] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [toolActionMessage, setToolActionMessage] = useState('');
  const [customToolResult, setCustomToolResult] = useState('');
  const [submittingToolAction, setSubmittingToolAction] = useState(false);
  const [artifacts, setArtifacts] = useState<WorkspaceFile[]>([]);
  const [artifactError, setArtifactError] = useState('');

  const agent = data.agents.find((item) => item.id === session.agent.id);
  const environment = data.environments.find((item) => item.id === session.environment_id);
  const selectedEvent = selectedEventId ? events.find((event) => event.id === selectedEventId) ?? null : null;
  const pendingToolUses = unresolvedToolUses(events);
  const pendingCustomToolUses = unresolvedCustomToolUses(events);

  const loadEvents = async () => {
    setLoadingEvents(true);
    setEventError('');
    try {
      const page = await getPage<SessionEvent>(`/v1/sessions/${encodeURIComponent(session.id)}/events?limit=1000`);
      setEvents(page.data);
      setSelectedEventId((current) => current && page.data.some((event) => event.id === current) ? current : null);
    } catch (err) {
      setEventError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingEvents(false);
    }
  };

  const loadArtifacts = async () => {
    try {
      const page = await getPage<WorkspaceFile>(`/v1/sessions/${encodeURIComponent(session.id)}/artifacts`);
      setArtifacts(page.data);
      setArtifactError('');
    } catch (err) {
      setArtifactError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void loadEvents();
    void loadArtifacts();
  }, [session.id]);

  const visibleEvents = events.filter((event) => {
    const kind = eventKind(event);
    if (mode === 'transcript' && !['user', 'agent', 'tool', 'error'].includes(kind)) return false;
    if (!selectedKinds.has(kind)) return false;
    const text = `${event.type} ${eventText(event)} ${event.id}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });
  const allKindsSelected = selectedKinds.size === SESSION_EVENT_KINDS.length;
  const eventFilterLabel = allKindsSelected ? 'All events' : `${selectedKinds.size} event type${selectedKinds.size === 1 ? '' : 's'}`;
  const hasEventFilters = !allKindsSelected || query.trim().length > 0;

  const canSendMessage = messageDraft.trim().length > 0
    && !sendingMessage
    && session.status !== 'failed'
    && session.status !== 'terminated';

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = messageDraft.trim();
    if (!content || sendingMessage) return;
    setSendingMessage(true);
    setMessageError('');
    try {
      await postJson(`/v1/sessions/${encodeURIComponent(session.id)}/messages`, { content, stream: false });
      setMessageDraft('');
      await loadEvents();
      onRefresh();
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingMessage(false);
    }
  };

  const interrupt = async () => {
    await postJson(`/v1/sessions/${encodeURIComponent(session.id)}/events`, { events: [{ type: 'user.interrupt', content: [{ type: 'text', text: 'Run interrupted by the user.' }] }] });
    setActionsOpen(false);
    await loadEvents();
    onRefresh();
  };

  const submitToolConfirmation = async (toolUseId: string, result: 'allow' | 'deny') => {
    setSubmittingToolAction(true);
    setToolActionMessage('');
    try {
      await postJson(`/v1/sessions/${encodeURIComponent(session.id)}/events`, {
        events: [{
          type: 'user.tool_confirmation',
          tool_use_id: toolUseId,
          result,
          ...(result === 'deny' ? { deny_message: 'Denied from Console.' } : {}),
        }],
      });
      setToolActionMessage(result === 'allow' ? 'Tool approved.' : 'Tool denied.');
      await loadEvents();
      onRefresh();
    } catch (err) {
      setToolActionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingToolAction(false);
    }
  };

  const submitCustomToolResult = async (customToolUseId: string) => {
    const content = customToolResult.trim();
    if (!content) return;
    setSubmittingToolAction(true);
    setToolActionMessage('');
    try {
      await postJson(`/v1/sessions/${encodeURIComponent(session.id)}/events`, {
        events: [{
          type: 'user.custom_tool_result',
          custom_tool_use_id: customToolUseId,
          content: [{ type: 'text', text: content }],
        }],
      });
      setCustomToolResult('');
      setToolActionMessage('Custom tool result submitted.');
      await loadEvents();
      onRefresh();
    } catch (err) {
      setToolActionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingToolAction(false);
    }
  };

  const archive = async () => {
    await deleteJson(`/v1/sessions/${session.id}`);
    setActionsOpen(false);
    onBack();
    onRefresh();
  };

  return (
    <section className="sessionDetail">
      <div className="sessionCrumb">
        <button type="button" className="textButton" onClick={onBack}>Sessions</button>
        <span>/</span>
        <strong>{shortId(session.id)}</strong>
      </div>

      <div className="sessionHero">
        <div className="sessionHeroMain">
          <div className="titleLine">
            <h1>{session.title || shortId(session.id)}</h1>
            <StatusPill status={session.status} />
          </div>
          <div className="sessionMetaRow">
            <span className="monoText">{shortId(session.id)}</span>
            <button className="resourceBadge" type="button" onClick={() => agent ? onOpenAgent(agent) : undefined}>
              <Monitor size={15} />
              {session.agent.name}
            </button>
            <ResourceBadge icon={<Cloud size={15} />} label={environment?.name ?? session.environment_id} />
            <span><Clock size={15} />{formatDuration(session.created_at, session.updated_at)}</span>
            <span><Clock size={15} />{relativeDate(session.created_at)}</span>
          </div>
        </div>
        <div className="sessionHeroActions">
          <div className="menuWrap">
            <button className="secondaryButton largeAction" type="button" onClick={() => setActionsOpen((open) => !open)}>
              Actions <ChevronDown size={16} />
            </button>
            {actionsOpen ? (
              <div className="agentMenu sessionActionsMenu">
                <button type="button" onClick={() => void interrupt()}><Square size={18} />Send interrupt</button>
                <button type="button" className="dangerMenuItem" onClick={() => void archive()}><Archive size={18} />Archive session</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <SummaryStrip items={[
        { label: 'Events', value: events.length, icon: <MessageSquare size={18} /> },
        { label: 'Artifacts', value: artifacts.length, icon: <FileText size={18} /> },
        { label: 'Pending actions', value: pendingToolUses.length + pendingCustomToolUses.length, icon: <Clock size={18} /> },
        { label: 'Usage', value: formatUsage(session.usage), icon: <Monitor size={18} /> },
      ]} />

      <div className="sessionToolbar">
        <div className="segment compactSegment">
          <button type="button" className={mode === 'transcript' ? 'active' : ''} onClick={() => setMode('transcript')}>Transcript</button>
          <button type="button" className={mode === 'debug' ? 'active' : ''} onClick={() => setMode('debug')}>Debug</button>
        </div>
        <div className="filterWrap">
          <button className="filterButton" type="button" onClick={() => setFilterOpen((open) => !open)}>{eventFilterLabel} <ChevronDown size={15} /></button>
          {filterOpen ? (
            <div className="eventFilterMenu">
              {SESSION_EVENT_KINDS.map((kind) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={selectedKinds.has(kind)}
                    onChange={(event) => toggleSet(kind, event.target.checked, setSelectedKinds)}
                  />
                  <span>{kind[0].toUpperCase() + kind.slice(1)}</span>
                </label>
              ))}
              <div className="eventFilterFooter">
                <button type="button" onClick={() => setSelectedKinds(new Set(SESSION_EVENT_KINDS))}>Select all</button>
                <button type="button" onClick={() => setSelectedKinds(new Set())}>Clear</button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="sessionSearch">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search events" placeholder="Search events" />
          {query ? (
            <button className="clearSearchButton" type="button" title="Clear event search" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          ) : null}
        </div>
        {hasEventFilters ? (
          <button className="textButton compactTextButton" type="button" onClick={() => { setSelectedKinds(new Set(SESSION_EVENT_KINDS)); setQuery(''); }}>
            Reset filters
          </button>
        ) : null}
        <div className="sessionIconActions">
          <button className="iconButton" type="button" title="Copy session id" onClick={() => void navigator.clipboard?.writeText(session.id)}><Copy size={18} /></button>
          <button className="iconButton" type="button" title="Download event JSON" onClick={() => downloadJson(`${session.id}-events.json`, events)}><Download size={18} /></button>
        </div>
      </div>

      {(pendingToolUses.length > 0 || pendingCustomToolUses.length > 0 || toolActionMessage) ? (
        <section className="requiresActionPanel">
          <div>
            <h2>Requires action</h2>
            <p>Resolve pending tool calls so the session can continue.</p>
          </div>
          {pendingToolUses.map((tool) => (
            <div className="requiresActionItem" key={tool.id}>
              <div>
                <strong>{tool.name}</strong>
                <code>{tool.id}</code>
                <pre>{JSON.stringify(tool.input, null, 2)}</pre>
              </div>
              <div className="toolbarActions">
                <button className="secondaryButton" type="button" disabled={submittingToolAction} onClick={() => void submitToolConfirmation(tool.id, 'deny')}>
                  Deny
                </button>
                <button className="primaryButton" type="button" disabled={submittingToolAction} onClick={() => void submitToolConfirmation(tool.id, 'allow')}>
                  Approve
                </button>
              </div>
            </div>
          ))}
          {pendingCustomToolUses.map((tool) => (
            <div className="requiresActionItem customResultItem" key={tool.id}>
              <div>
                <strong>{tool.name}</strong>
                <code>{tool.id}</code>
                <pre>{JSON.stringify(tool.input, null, 2)}</pre>
              </div>
              <label>
                <span>Custom tool result</span>
                <textarea value={customToolResult} onChange={(event) => setCustomToolResult(event.target.value)} placeholder="Paste the result returned by your external tool..." />
              </label>
              <button className="primaryButton" type="button" disabled={submittingToolAction || !customToolResult.trim()} onClick={() => void submitCustomToolResult(tool.id)}>
                Submit result
              </button>
            </div>
          ))}
          {toolActionMessage ? <div className="noticeBox">{toolActionMessage}</div> : null}
        </section>
      ) : null}

      {(artifacts.length > 0 || artifactError) ? (
        <section className="sessionArtifactsPanel">
          <div className="sectionTitleRow">
            <div>
              <h2>Artifacts</h2>
              <p>Generated outputs captured for this session. Text-like artifacts include previews.</p>
            </div>
            <button className="iconButton quiet" type="button" title="Refresh artifacts" onClick={() => void loadArtifacts()}>
              <RefreshCw size={16} />
            </button>
          </div>
          {artifactError ? <p className="errorText">{artifactError}</p> : null}
          <div className="artifactGrid">
            {artifacts.map((artifact) => (
              <article className="artifactCard" key={artifact.id}>
                <div className="artifactCardHeader">
                  <FileText size={17} />
                  <div>
                    <strong>{artifact.name}</strong>
                    <code>{artifact.artifact_path ?? artifact.id}</code>
                  </div>
                  <a className="iconButton quiet" href={`/v1/sessions/${encodeURIComponent(session.id)}/artifacts/${encodeURIComponent(artifact.id)}/content`} download={artifact.name} title="Download artifact">
                    <Download size={16} />
                  </a>
                </div>
                {artifact.preview ? (
                  <pre>{artifact.preview}{artifact.preview_truncated ? '\n…' : ''}</pre>
                ) : (
                  <div className="artifactEmptyPreview">
                    <FileText size={18} />
                    <span>No inline preview for {artifact.media_type}</span>
                  </div>
                )}
                <small>{formatBytes(artifact.size_bytes)} · {formatDateShort(artifact.created_at)}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="sessionTimeline">
        <div className="eventMiniMap">
          {events.length > 0
            ? events.slice(0, 42).map((event) => <span key={event.id} className={`miniEvent ${eventKind(event)}`} title={event.type} />)
            : <span className="miniEventEmpty">No events yet</span>}
        </div>
        <div className="eventPane">
          <div className="eventList">
            {eventError ? <div className="banner error inlineBanner">{eventError}</div> : null}
            {loadingEvents ? <LoadingState /> : null}
            {!loadingEvents && visibleEvents.map((event) => (
              <button
                type="button"
                key={event.id}
                className={`eventRow ${selectedEvent?.id === event.id ? 'active' : ''}`}
                onClick={() => setSelectedEventId(event.id)}
              >
                <span className={`eventType ${eventKind(event)}`}>{eventLabel(event, mode)}</span>
                <strong>{eventTitle(event)}</strong>
                <time>{eventTime(event)}</time>
              </button>
            ))}
            {!loadingEvents && visibleEvents.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No events" body="No events match the current filters. Clear the search or enable more event types." /> : null}
          </div>
          <div className="eventInspector">
            {selectedEvent ? (
              <>
                <div className="eventInspectorHeader">
                  <button className="iconButton" type="button" title="Close selection" onClick={() => setSelectedEventId(null)}><X size={18} /></button>
                  <div>
                    <span className={`eventType ${eventKind(selectedEvent)}`}>{selectedEvent.type}</span>
                    <h2>{eventTitle(selectedEvent)}</h2>
                    <p>{eventTime(selectedEvent)}</p>
                  </div>
                  <div className="segment tinySegment">
                    <button type="button" className={detailMode === 'rendered' ? 'active' : ''} onClick={() => setDetailMode('rendered')}>Rendered</button>
                    <button type="button" className={detailMode === 'raw' ? 'active' : ''} onClick={() => setDetailMode('raw')}>Raw</button>
                  </div>
                </div>
                {detailMode === 'rendered' ? (
                  <RenderedEventContent event={selectedEvent} />
                ) : (
                  <pre className="rawEvent">{JSON.stringify(selectedEvent, null, 2)}</pre>
                )}
              </>
            ) : (
              <EmptyState icon={<MessageSquare size={22} />} title="Select an event" body="Choose an event to inspect rendered content or raw JSON." />
            )}
          </div>
        </div>
      </div>

      <form className="sessionComposer" onSubmit={(event) => void sendMessage(event)}>
        <textarea
          value={messageDraft}
          onChange={(event) => setMessageDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          placeholder="Message this session..."
          aria-label="Message this session"
          disabled={sendingMessage || session.status === 'failed' || session.status === 'terminated'}
        />
        <button className="primaryButton" type="submit" disabled={!canSendMessage}>
          <Send size={16} />
          {sendingMessage ? 'Sending...' : 'Send'}
        </button>
        {messageError ? <div className="sessionComposerError">{messageError}</div> : null}
      </form>
    </section>
  );
}

function toggleSet<T>(value: T, checked: boolean, setter: Dispatch<SetStateAction<Set<T>>>) {
  setter((current) => {
    const next = new Set(current);
    if (checked) next.add(value);
    else next.delete(value);
    return next;
  });
}

function eventKind(event: SessionEvent): 'user' | 'agent' | 'tool' | 'error' | 'system' {
  if (event.type.startsWith('user.')) return 'user';
  if (event.type.startsWith('agent.')) return event.type.includes('tool') ? 'tool' : 'agent';
  if (event.type.includes('tool') || event.type.includes('mcp')) return 'tool';
  if (event.type.includes('error') || event.type.includes('failed')) return 'error';
  return 'system';
}

function unresolvedToolUses(events: SessionEvent[]) {
  const resolved = new Set<string>();
  const tools: Array<{ id: string; name: string; input: unknown }> = [];
  for (const event of events) {
    for (const block of event.content ?? []) {
      const record = block as Record<string, unknown>;
      if (record.type === 'tool_result' && typeof record.tool_use_id === 'string') {
        resolved.add(record.tool_use_id);
      }
    }
  }
  for (const event of events) {
    if (event.type !== 'agent.tool_use' && event.type !== 'agent.mcp_tool_use') continue;
    for (const block of event.content ?? []) {
      const record = block as Record<string, unknown>;
      if (record.type === 'tool_use' && typeof record.id === 'string' && !resolved.has(record.id)) {
        tools.push({
          id: record.id,
          name: typeof record.name === 'string' ? record.name : 'tool',
          input: record.input ?? {},
        });
      }
    }
  }
  return tools;
}

function unresolvedCustomToolUses(events: SessionEvent[]) {
  const resolved = new Set<string>();
  const tools: Array<{ id: string; name: string; input: unknown }> = [];
  for (const event of events) {
    if (event.type === 'user.custom_tool_result') {
      for (const block of event.content ?? []) {
        const record = block as Record<string, unknown>;
        if (typeof record.custom_tool_use_id === 'string') resolved.add(record.custom_tool_use_id);
      }
    }
  }
  for (const event of events) {
    if (event.type !== 'agent.custom_tool_use') continue;
    for (const block of event.content ?? []) {
      const record = block as Record<string, unknown>;
      if (record.type === 'tool_use' && typeof record.id === 'string' && !resolved.has(record.id)) {
        tools.push({
          id: record.id,
          name: typeof record.name === 'string' ? record.name : 'custom tool',
          input: record.input ?? {},
        });
      }
    }
  }
  return tools;
}

function RenderedEventContent({ event }: { event: SessionEvent }) {
  const rendered = eventText(event);
  return (
    <div className={`renderedEvent ${rendered ? '' : 'emptyRenderedEvent'}`}>
      {rendered || 'No rendered content for this event. Open Raw to inspect the full payload.'}
    </div>
  );
}

function eventLabel(event: SessionEvent, mode: 'transcript' | 'debug') {
  if (mode === 'debug') return truncateMiddle(event.type, 22);
  const kind = eventKind(event);
  return kind[0].toUpperCase() + kind.slice(1);
}

function eventTitle(event: SessionEvent) {
  const text = eventText(event);
  if (event.type === 'user.message') return text || 'User message';
  if (event.type === 'agent.message') return text || 'Agent message';
  if (event.type === 'user.interrupt') return 'Interrupted';
  if (event.type === 'session.error') return text || 'Session error';
  if (event.type.includes('model') && event.type.endsWith('start')) return 'Model request start';
  if (event.type.includes('model') && event.type.endsWith('end')) return text ? `Model request stop (${text})` : 'Model request stop';
  return titleCase(event.type.replaceAll('.', ' ').replaceAll('_', ' '));
}

function eventText(event: SessionEvent) {
  if (event.delta) return event.delta;
  if (!event.content || event.content.length === 0) return '';
  return event.content.map((part) => {
    if (part && typeof part === 'object') {
      const record = part as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.message === 'string') return record.message;
      if (typeof record.error === 'string') return record.error;
    }
    return typeof part === 'string' ? part : JSON.stringify(part);
  }).join('\n');
}

function eventTime(event: SessionEvent) {
  const value = event.processed_at ?? event.created_at;
  if (!value) return '-';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}
