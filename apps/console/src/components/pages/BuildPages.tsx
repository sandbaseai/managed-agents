import { ChangeEvent, DragEvent, FormEvent, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, FileText, Plus, Search, Trash2, Upload, X, Zap } from 'lucide-react';
import { postForm } from '../../api';
import type { ConsoleData, Skill, WorkspaceFile } from '../../types';
import { EmptyState, FilterSelect, ResourceBadge, SummaryStrip } from '../Common';
import { Modal } from '../Modal';
import { formatBytes, formatDateShort, formatDateWithYear, shortId } from '../../lib/format';

export function Skills({ data, onRefresh }: { data: ConsoleData; onRefresh: () => void }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | Skill['source']>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.skills.filter((skill) => {
      const sourceMatches = source === 'all' || skill.source === source;
      const queryMatches = !q
        || skill.id.toLowerCase().includes(q)
        || skill.name.toLowerCase().includes(q)
        || skillDisplayName(skill).toLowerCase().includes(q)
        || skill.description.toLowerCase().includes(q);
      return sourceMatches && queryMatches;
    });
  }, [data.skills, query, source]);
  const selected = selectedId ? filtered.find((skill) => skill.id === selectedId) ?? null : null;
  const customSkills = data.skills.filter((skill) => skill.source === 'custom').length;
  const anthropicSkills = data.skills.filter((skill) => skill.source === 'anthropic').length;
  const versionCount = data.skills.reduce((sum, skill) => sum + skill.versions.length, 0);

  return (
    <section className="stack skillsPage">
      <div className="pageIntro">
        <div>
          <h1>Skills</h1>
          <p>Upload reusable instruction packages and attach them to agents without duplicating prompts.</p>
        </div>
        <div className="toolbarActions">
          <button className="primaryButton" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            Create skill
          </button>
          <a className="iconButton" href="https://github.com/sandbaseai/managed-agents/blob/main/docs/skills.md" target="_blank" rel="noreferrer" title="Documentation">
            <FileText size={18} />
          </a>
        </div>
      </div>

      <SummaryStrip items={[
        { label: 'Skills', value: data.skills.length, icon: <Zap size={18} /> },
        { label: 'Custom', value: customSkills, icon: <Upload size={18} /> },
        { label: 'Anthropic', value: anthropicSkills, icon: <FileText size={18} /> },
        { label: 'Versions', value: versionCount, icon: <Download size={18} /> },
      ]} />

      <div className="toolbar compactToolbar">
        <label className="searchBox">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or exact ID" />
        </label>
        <FilterSelect
          label="Source"
          value={source}
          onChange={(value) => setSource(value as 'all' | Skill['source'])}
          options={[
            { value: 'all', label: 'All' },
            { value: 'anthropic', label: 'Anthropic' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      </div>

      <div className={`skillsLayout ${selected ? 'hasDrawer' : ''}`}>
        <div className="tablePanel skillTablePanel">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Source</th>
                <th>Latest version</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((skill) => (
                <tr
                  key={skill.id}
                  className={`clickableRow ${selected?.id === skill.id ? 'selectedRow' : ''}`}
                  onClick={() => setSelectedId(skill.id)}
                >
                  <td><strong className="monoCell">{skill.id}</strong></td>
                  <td>
                    <strong>{skillDisplayName(skill)}</strong>
                  </td>
                  <td><SourceBadge source={skill.source} /></td>
                  <td>{formatSkillLatestVersion(skill)}</td>
                  <td>{formatDateShort(skill.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? <EmptyState icon={<Zap size={22} />} title="No skills" body="Upload a Skill package with SKILL.md to reuse instructions across agents." /> : null}
        </div>

        {selected ? <SkillDetailsDrawer skill={selected} onClose={() => setSelectedId(null)} /> : null}
      </div>

      {createOpen ? (
        <CreateSkillModal
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

function SkillDetailsDrawer({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  return (
    <aside className="skillDrawer">
      <div className="drawerHeader">
        <div>
          <div className="titleLine compact">
            <h2>{skillDisplayName(skill)}</h2>
            <SourceBadge source={skill.source} />
          </div>
          <p>{formatDateShort(skill.updated_at)} · <span className="monoText">{skill.id}</span></p>
        </div>
        <button className="iconButton quiet" type="button" onClick={onClose} title="Close"><X size={18} /></button>
      </div>
      <div className="drawerBody">
        <p>{skill.description}</p>
        <div className="drawerMetaGrid">
          <span>Source</span>
          <strong>{skill.source === 'anthropic' ? 'Anthropic' : 'Custom'}</strong>
          <span>Latest version</span>
          <strong>{formatSkillLatestVersion(skill)}</strong>
          <span>Package</span>
          <strong className="monoText">{skillPackageName(skill) ?? '-'}</strong>
          <span>File</span>
          <strong className="monoText">{skill.file ?? '-'}</strong>
        </div>
        <div className="skillVersionSection">
          <h3>Versions</h3>
          <div className="skillVersionList">
            {skill.versions.map((version) => (
              <div className="skillVersionRow" key={version.id}>
                <span className="monoText">{version.id}</span>
                <small>{formatDateShort(version.created_at)}</small>
                {version.latest ? <b>Latest</b> : null}
              </div>
            ))}
            {skill.versions.length === 0 ? (
              <EmptyState
                icon={<FileText size={20} />}
                title="No versions"
                body="Upload a new Skill package version to make this Skill attachable with an immutable reference."
              />
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}

function CreateSkillModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const packageInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Array<{ file: File; path: string }>>([]);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = selectedFiles.length > 0;

  const pickFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setSelectedFiles(files.map((file) => ({
      file,
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    })));
    setError('');
  };

  const onPackageChange = (event: ChangeEvent<HTMLInputElement>) => {
    pickFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    pickFiles(event.dataTransfer.files);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const body = new FormData();
      for (const item of selectedFiles) {
        body.append('files', item.file, item.path);
      }
      await postForm('/v1/skills', body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create skill" onClose={onClose}>
      <form className="modalForm" onSubmit={submit}>
        {error ? (
          <div className="formAlert error">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        ) : null}
        <input
          ref={packageInputRef}
          className="hiddenFileInput"
          type="file"
          accept=".zip,.skill,application/zip"
          onChange={onPackageChange}
        />
        <div
          className={`skillUploadDropzone ${dragActive ? 'dragActive' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          <Upload size={26} />
          <strong>Drag and drop a .zip or .skill package to upload</strong>
          <span>The package is unpacked and validated. It must contain one top-level folder with SKILL.md at the root.</span>
          <div className="skillUploadActions">
            <button className="secondaryButton" type="button" onClick={() => packageInputRef.current?.click()}>
              Select file
            </button>
          </div>
        </div>
        <div className="uploadRequirementGrid">
          <span><strong>1</strong> One top-level folder</span>
          <span><strong>2</strong> Root SKILL.md required</span>
          <span><strong>3</strong> References stay inside package</span>
        </div>
        {selectedFiles.length > 0 ? (
          <div className="skillUploadFile">
            <FileText size={20} />
            <div>
              <strong>{selectedFiles[0].path}</strong>
              <span>{selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} · {formatBytes(selectedFiles.reduce((total, item) => total + item.file.size, 0))}</span>
            </div>
            <button className="iconButton quiet" type="button" onClick={() => setSelectedFiles([])} title="Remove upload">
              <Trash2 size={17} />
            </button>
          </div>
        ) : null}
        <div className="modalActions">
          <button className="primaryButton" type="submit" disabled={!canSave || saving}>
            {saving ? 'Creating...' : 'Continue'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SourceBadge({ source }: { source: Skill['source'] }) {
  return <span className={`sourceBadge ${source}`}>{source === 'anthropic' ? 'Anthropic' : 'Custom'}</span>;
}

function skillDisplayName(skill: Skill): string {
  return skill.display_title || skill.name || skillPackageName(skill) || skill.id;
}

function skillPackageName(skill: Skill): string | null {
  if (!skill.file) return null;
  return skill.file.split('/').filter(Boolean)[0] ?? null;
}

function formatSkillLatestVersion(skill: Skill): string {
  const version = skill.latest_version;
  if (!version) return '-';
  if (/^\d{8}$/.test(version)) {
    return formatDateWithYear(`${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}T00:00:00.000Z`);
  }
  if (/^\d{12,}$/.test(version)) {
    const timestamp = Number(version);
    if (Number.isFinite(timestamp)) return formatDateWithYear(new Date(timestamp).toISOString());
  }
  return skill.updated_at ? formatDateWithYear(skill.updated_at) : version;
}

export function Files({ data, onRefresh }: { data: ConsoleData; onRefresh: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [error, setError] = useState('');
  const files = useMemo(() => [...data.files].sort((a, b) => b.created_at.localeCompare(a.created_at)), [data.files]);
  const artifactCount = files.filter((file) => file.role === 'artifact').length;
  const uploadedFileCount = files.filter((file) => file.role === 'file').length;
  const totalBytes = files.reduce((sum, file) => sum + file.size_bytes, 0);
  const latestFile = files[0];

  const uploadFiles = async (fileList: FileList | null) => {
    const uploads = Array.from(fileList ?? []);
    if (uploads.length === 0) return;
    setUploading(true);
    setError('');
    try {
      for (const file of uploads) {
        const body = new FormData();
        body.append('file', file, file.name);
        await postForm<WorkspaceFile>('/v1/files', body);
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const onUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    void uploadFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  };

  const onFilesDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setFileDragActive(false);
    void uploadFiles(event.dataTransfer.files);
  };

  return (
    <section className="stack filesView claudeFilesView">
      <div className="pageIntro">
        <div>
          <h1>Files</h1>
          <p>Upload and manage files to use with agent sessions.</p>
        </div>
        <div className="toolbarActions">
          <input ref={inputRef} className="hiddenFileInput" type="file" multiple onChange={onUploadChange} />
          <button className="primaryButton" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
            <Upload size={16} />
            {uploading ? 'Uploading...' : 'Upload file'}
          </button>
          <a className="iconButton" href="https://github.com/sandbaseai/managed-agents/blob/main/docs/api.md#files" target="_blank" rel="noreferrer" title="Documentation">
            <FileText size={18} />
          </a>
        </div>
      </div>
      {error ? (
        <div className="formAlert error fileUploadError">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}
      <div
        className={`fileUploadDropzone ${fileDragActive ? 'dragActive' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setFileDragActive(true);
        }}
        onDragLeave={() => setFileDragActive(false)}
        onDrop={onFilesDrop}
      >
        <div>
          <Upload size={22} />
          <strong>{uploading ? 'Uploading files...' : 'Drop files here to upload'}</strong>
          <span>Files are stored locally and can be mounted into sessions as resources.</span>
        </div>
        <button className="secondaryButton" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
          Select files
        </button>
      </div>
      <SummaryStrip items={[
        { label: 'Files', value: uploadedFileCount, icon: <FileText size={18} /> },
        { label: 'Artifacts', value: artifactCount, icon: <Download size={18} /> },
        { label: 'Storage used', value: formatBytes(totalBytes), icon: <Upload size={18} /> },
        { label: 'Latest', value: latestFile ? formatDateShort(latestFile.created_at) : 'None', icon: <FileText size={18} /> },
      ]} />
      <div className="resourceTruthStrip" aria-label="Files truth model">
        <div><span>Inputs</span><strong>Uploaded files are reusable resources that can be mounted into sessions.</strong></div>
        <div><span>Artifacts</span><strong>Generated outputs remain visible here but are produced by a specific session.</strong></div>
        <div><span>Storage</span><strong>All file bytes use the configured local artifact storage boundary.</strong></div>
      </div>
      <div className="tablePanel filesTablePanel claudeFilesTable">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Role</th>
              <th>Size</th>
              <th>Created</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.id}>
                <td><strong className="monoCell">{shortId(file.id)}</strong></td>
                <td><strong>{file.name}</strong></td>
                <td><ResourceBadge>{file.role === 'artifact' ? 'Artifact' : 'File'}</ResourceBadge></td>
                <td>{formatBytes(file.size_bytes)}</td>
                <td>{formatDateShort(file.created_at)}</td>
                <td className="rowActionsCell">
                  <a className="iconButton quiet" href={`/v1/files/${encodeURIComponent(file.id)}/content`} download={file.name} title="Download file">
                    <Download size={16} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {files.length === 0 ? (
          <EmptyState
            icon={<FileText size={22} />}
            title="No files"
            body="Upload files once, then mount them into sessions as resources."
            action={<button className="primaryButton" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}><Upload size={16} />Upload file</button>}
          />
        ) : null}
      </div>
      <div className="mobileResourceList">
        {files.map((file) => (
          <div className="mobileResourceCard" key={file.id}>
            <span className="mobileAgentMain">
              <strong>{file.name}</strong>
              <small className="monoText">{file.id}</small>
            </span>
            <span className="mobileAgentMeta">
              <span>{file.role === 'artifact' ? 'Artifact' : 'File'} · {formatBytes(file.size_bytes)}</span>
              <a className="iconButton quiet" href={`/v1/files/${encodeURIComponent(file.id)}/content`} download={file.name} title="Download file">
                <Download size={16} />
              </a>
            </span>
          </div>
        ))}
        {files.length === 0 ? (
          <EmptyState
            icon={<FileText size={22} />}
            title="No files"
            body="Upload files once, then mount them into sessions as resources."
            action={<button className="primaryButton" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}><Upload size={16} />Upload file</button>}
          />
        ) : null}
      </div>
    </section>
  );
}
