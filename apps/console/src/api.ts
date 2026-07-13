import type { Page } from './types';

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export async function getPage<T>(path: string): Promise<Page<T>> {
  return getJson<Page<T>>(path);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, 'POST', body);
}

export async function postForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', body });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message ?? `${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, 'PUT', body);
}

export async function deleteJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'DELETE' });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message ?? `${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function requestJson<T>(path: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message ?? `${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}
