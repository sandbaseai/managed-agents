import type { Session, Workspace } from '../types';

export function formatDate(value: string | null | undefined) {
  if (!value) return 'never';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function formatDateShort(value: string | null | undefined) {
  if (!value) return 'never';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

export function formatDateWithYear(value: string | null | undefined) {
  if (!value) return 'never';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export function relativeDate(value: string | null | undefined) {
  if (!value) return 'unknown';
  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 0) return formatDateShort(value);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export function formatDuration(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return '-';
  const endTime = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((endTime - new Date(start).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remaining}s`;
  return `${remaining}s`;
}

export function formatUsage(usage: Session['usage']) {
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  return input || output ? `${input} / ${output}` : '-';
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

export function workspaceConfigDir(workspace: Workspace | null): string {
  return workspace?.configDir ?? directoryName(workspace?.configPath) ?? workspace?.root ?? '';
}

export function directoryName(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const trimmed = path.replace(/\/+$/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  return lastSlash > 0 ? trimmed.slice(0, lastSlash) : trimmed;
}

export function pathName(path: string | undefined): string {
  if (!path) return '';
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

export function relativeWorkspacePath(path: string | undefined, base: string, kind: 'directory' | 'file'): string | undefined {
  if (!path) return undefined;
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.replace(/\/+$/, '');
  let label = pathName(path);
  if (normalizedBase && normalizedPath === normalizedBase) {
    label = './';
  } else if (normalizedBase && normalizedPath.startsWith(`${normalizedBase}/`)) {
    label = normalizedPath.slice(normalizedBase.length + 1);
  }
  return kind === 'directory' && label !== './' && !label.endsWith('/') ? `${label}/` : label;
}

export function copyText(value: string) {
  void navigator.clipboard?.writeText(value).catch(() => undefined);
}

export function shortId(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const edge = Math.max(4, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, edge)}...${value.slice(-edge)}`;
}

export function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
