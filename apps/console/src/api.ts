import type { Page } from './types';

const API_KEY_STORAGE_KEY = 'managed-agents.api-key';

export function getStoredApiKey(): string {
  return window.localStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
}

export function setStoredApiKey(key: string): void {
  if (key.trim()) {
    window.localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
  }
}

export function clearStoredApiKey(): void {
  window.localStorage.removeItem(API_KEY_STORAGE_KEY);
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export async function getText(path: string): Promise<string> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.text();
}

export async function getPage<T>(path: string): Promise<Page<T>> {
  return getJson<Page<T>>(path);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, 'POST', body);
}

export async function postForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: authHeaders(), body });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as ErrorResponse | null;
    throw new Error(errorMessage(path, res.status, detail));
  }
  return res.json() as Promise<T>;
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, 'PUT', body);
}

export async function deleteJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as ErrorResponse | null;
    throw new Error(errorMessage(path, res.status, detail));
  }
  return res.json() as Promise<T>;
}

async function requestJson<T>(path: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as ErrorResponse | null;
    throw new Error(errorMessage(path, res.status, detail));
  }
  return res.json() as Promise<T>;
}

type ErrorResponse = {
  error?: { message?: string };
  errors?: Array<{ path?: string; message?: string }>;
};

function errorMessage(path: string, status: number, detail: ErrorResponse | null): string {
  if (detail?.errors?.length) {
    return detail.errors
      .map((item) => `${item.path || 'config'}: ${item.message || 'Invalid value'}`)
      .join('\n');
  }
  return detail?.error?.message ?? `${path} returned ${status}`;
}

function authHeaders(): HeadersInit {
  const key = getStoredApiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}
