import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export type WorkerPollOptions = {
  port: string;
  apiKey?: string;
  environmentId?: string;
  environmentKey?: string;
  workerId?: string;
  workdir: string;
  once?: boolean;
  intervalMs?: string;
};

type WorkerItem = {
  id: string;
  sessionId?: string;
  session_id?: string;
  kind: 'exec' | 'read' | 'write' | 'list';
  payload: Record<string, unknown>;
};

export async function workerPollCommand(opts: WorkerPollOptions) {
  const workerId = opts.workerId ?? `worker_${process.pid}`;
  const intervalMs = Math.max(250, Number(opts.intervalMs ?? 1000));
  const root = resolve(opts.workdir);
  console.log(`Polling self-hosted work as ${workerId} in ${root}`);
  for (;;) {
    const item = await claimWorkItem(opts, workerId);
    if (item) {
      try {
        await completeWorkItem(opts, item, { status: 'fulfilled', value: await executeWorkItem(item, root) });
      } catch (error) {
        await completeWorkItem(opts, item, { status: 'rejected', reason: error });
      }
      console.log(`completed ${item.id}`);
    } else if (opts.once) {
      console.log('no work');
      return;
    }
    if (opts.once) return;
    await sleep(intervalMs);
  }
}

export async function executeWorkItem(item: WorkerItem, root: string): Promise<unknown> {
  if (item.kind === 'read') {
    return readFile(safePath(root, stringPayload(item.payload.path, 'path')), 'utf8');
  }
  if (item.kind === 'write') {
    const target = safePath(root, stringPayload(item.payload.path, 'path'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, String(item.payload.content ?? ''), 'utf8');
    return { ok: true };
  }
  if (item.kind === 'list') {
    return readdir(safePath(root, stringPayload(item.payload.path ?? '.', 'path')));
  }
  if (item.kind === 'exec') {
    return execShell(String(item.payload.command ?? ''), {
      cwd: item.payload.cwd ? safePath(root, String(item.payload.cwd)) : root,
      timeoutMs: typeof item.payload.timeout === 'number' ? item.payload.timeout : 300_000,
      env: objectOfStrings(item.payload.env),
    });
  }
  throw new Error(`Unsupported work item kind: ${item.kind}`);
}

async function claimWorkItem(opts: WorkerPollOptions, workerId: string): Promise<WorkerItem | null> {
  const res = await fetch(`http://localhost:${opts.port}/v1/x/worker/claim`, {
    method: 'POST',
    headers: jsonHeaders(opts),
    body: JSON.stringify({
      worker_id: workerId,
      environment_id: opts.environmentId,
      environment_key: opts.environmentKey ?? process.env.MANAGED_AGENTS_ENVIRONMENT_KEY,
    }),
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`worker claim failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<WorkerItem>;
}

async function completeWorkItem(opts: WorkerPollOptions, item: WorkerItem, resultOrError: PromiseSettledResult<unknown>) {
  const body = resultOrError.status === 'fulfilled'
    ? { id: item.id, result: resultOrError.value }
    : { id: item.id, result: { message: resultOrError.reason instanceof Error ? resultOrError.reason.message : String(resultOrError.reason) }, failed: true };
  const res = await fetch(`http://localhost:${opts.port}/v1/x/worker/complete`, {
    method: 'POST',
    headers: jsonHeaders(opts),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`worker complete failed: ${res.status} ${await res.text()}`);
}

async function execShell(command: string, opts: { cwd: string; timeoutMs: number; env: Record<string, string> }) {
  if (!command.trim()) throw new Error('exec work item requires command');
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-lc', command], {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      env: { ...process.env, ...opts.env },
    }, (error, stdout, stderr) => {
      resolve({
        exitCode: typeof (error as { code?: unknown } | null)?.code === 'number' ? (error as { code: number }).code : 0,
        stdout,
        stderr,
        timedOut: Boolean((error as { killed?: boolean } | null)?.killed),
      });
    });
  });
}

function safePath(root: string, value: string): string {
  const target = resolve(root, isAbsolute(value) ? `.${value}` : value);
  const rel = relative(root, target);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return target;
  throw new Error(`Path escapes worker root: ${value}`);
}

function stringPayload(value: unknown, name: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`${name} is required`);
}

function objectOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, String(val)]));
}

function jsonHeaders(opts: WorkerPollOptions): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
