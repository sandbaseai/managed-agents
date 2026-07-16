import { ChevronDown, Database, FileText, MoreVertical, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState, FilterSelect, StatusPill, Toolbar } from '../Common';
import { formatDate, shortId } from '../../lib/format';
import type { ConsoleData, MemoryRecord, MemoryStore } from '../../types';

export function MemoryStores({ data, onNew, onOpenMemoryStore }: { data: ConsoleData; onNew: () => void; onOpenMemoryStore: (store: MemoryStore) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const stores = data.memoryStores.filter((store) => {
    const q = query.toLowerCase();
    const matchesStatus = status === 'all' || (status === 'active' ? !store.archived_at : status === 'archived' ? !!store.archived_at : store.status === status);
    const matchesQuery = store.id.toLowerCase().includes(q) || store.name.toLowerCase().includes(q) || store.description.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Memory stores</h1>
          <p>Browse and manage persistent memory for your agents.</p>
        </div>
        <div className="toolbarActions">
          <button className="darkButton" type="button" onClick={onNew}>
            <Plus size={18} />
            Create memory store
          </button>
          <button className="iconButton" type="button" title="Documentation"><FileText size={18} /></button>
        </div>
      </div>
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by name or exact ID"
        actions={(
          <>
            <FilterSelect label="Created" value="all" onChange={() => undefined} options={[{ value: 'all', label: 'All time' }]} />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'all', label: 'All' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
          </>
        )}
      />
      <div className="tablePanel resourceTablePanel">
        <table className="resourceTable">
          <thead>
            <tr>
              <th className="selectCol"><input type="checkbox" aria-label="Select memory stores" /></th>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Created</th>
              <th className="actionsCol" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => (
              <tr key={store.id} className="clickableRow" onClick={() => onOpenMemoryStore(store)}>
                <td className="selectCol" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${store.id}`} /></td>
                <td><strong className="monoText">{shortId(store.id)}</strong></td>
                <td>{store.name}</td>
                <td><StatusPill status={store.status} /></td>
                <td>{formatDateShort(store.created_at)}</td>
                <td className="actionsCol" onClick={(event) => event.stopPropagation()}>
                  <button className="iconButton quiet" type="button" title="Memory store actions"><MoreVertical size={18} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stores.length === 0 ? <EmptyState icon={<Database size={22} />} title="No memory stores" /> : null}
      </div>
    </section>
  );
}

export function MemoryStoreDetail({
  store,
  onBack,
  onRefresh,
  onNewMemory,
}: {
  store: MemoryStore;
  onBack: () => void;
  onRefresh: () => void;
  onNewMemory: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(store.memories[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const selected = store.memories.find((memory) => memory.id === selectedId) ?? null;
  const [content, setContent] = useState(selected?.content ?? '');

  useEffect(() => {
    setSelectedId((current) => current && store.memories.some((memory) => memory.id === current) ? current : store.memories[0]?.id ?? null);
  }, [store.id, store.memories]);

  useEffect(() => {
    setContent(selected?.content ?? '');
    setEditing(false);
  }, [selected?.id]);

  const save = async () => {
    if (!selected) return;
    await putJson(`/v1/memory_stores/${store.id}/memories/${selected.id}`, { content });
    setEditing(false);
    onRefresh();
  };

  return (
    <section className="environmentDetail memoryStoreDetail">
      <div className="detailCrumb">
        <button type="button" className="textButton" onClick={onBack}>Memory stores</button>
        <span>/</span>
        <strong>{store.name}</strong>
      </div>
      <div className="resourceHero">
        <div>
          <div className="titleLine">
            <h1>{store.name}</h1>
            <StatusPill status={store.status} />
          </div>
          <p className="mutedLine"><span className="monoText">{shortId(store.id)}</span> · Created {formatDateShort(store.created_at)}</p>
          {store.description ? <p className="agentDescription">{store.description}</p> : null}
        </div>
        <button className="darkButton largeAction" type="button" onClick={onNewMemory}>
          <Plus size={18} />
          Add memory
        </button>
      </div>

      <div className="memoryBrowser tablePanel">
        <div className="memoryTree">
          <MemoryTree memories={store.memories} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        </div>
        <div className="memoryContent">
          {selected ? (
            <>
              <div className="memoryContentHeader">
                <div>
                  <h2>{selected.path}</h2>
                  <p><span className="monoText">{shortId(selected.id)}</span> · Updated {formatDateShort(selected.updated_at)}</p>
                </div>
                {editing ? (
                  <div className="toolbarActions">
                    <button className="secondaryButton" type="button" onClick={() => { setEditing(false); setContent(selected.content); }}><X size={16} />Cancel</button>
                    <button className="darkButton" type="button" onClick={() => void save()}><Check size={16} />Save</button>
                  </div>
                ) : (
                  <button className="secondaryButton" type="button" onClick={() => setEditing(true)}><Pencil size={18} />Edit</button>
                )}
              </div>
              {editing ? (
                <textarea className="memoryEditor" value={content} onChange={(event) => setContent(event.target.value)} />
              ) : (
                <pre className="memoryPreview">{selected.content}</pre>
              )}
            </>
          ) : (
            <EmptyState icon={<Database size={24} />} title="Select a memory" />
          )}
        </div>
      </div>
    </section>
  );
}

function MemoryTree({ memories, selectedId, onSelect }: { memories: MemoryRecord[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const groups = useMemo(() => groupMemoriesByFolder(memories), [memories]);
  if (memories.length === 0) return <div className="memoryTreeEmpty">No memories</div>;
  return (
    <>
      {groups.map((group) => (
        <div className="memoryFolder" key={group.folder}>
          <div className="memoryFolderTitle">
            <ChevronDown size={16} />
            <Database size={16} />
            <span>{group.folder}</span>
          </div>
          {group.items.map((memory) => (
            <button
              type="button"
              key={memory.id}
              className={`memoryNode ${selectedId === memory.id ? 'active' : ''}`}
              onClick={() => onSelect(memory.id)}
            >
              <FileText size={15} />
              <span>{memoryName(memory.path)}</span>
              <small>{memory.content.length} B</small>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

function groupMemoriesByFolder(memories: MemoryRecord[]): Array<{ folder: string; items: MemoryRecord[] }> {
  const folders = new Map<string, MemoryRecord[]>();
  for (const memory of memories) {
    const segments = memory.path.split('/').filter(Boolean);
    const folder = segments.length > 1 ? segments.slice(0, -1).join('/') : 'root';
    const items = folders.get(folder) ?? [];
    items.push(memory);
    folders.set(folder, items);
  }
  return [...folders.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folder, items]) => ({ folder, items: items.sort((left, right) => left.path.localeCompare(right.path)) }));
}

function memoryName(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}
