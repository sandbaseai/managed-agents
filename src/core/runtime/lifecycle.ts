import { spawn } from 'node:child_process';
import type { Database } from '@/core/db/database.js';
import type { Logger } from '@/core/observability/logger.js';
import type { SessionManager } from '@/core/session/session-manager.js';

export type RuntimeStopMode = 'shutdown' | 'restart';

export type ClosableServer = {
  close(callback?: (err?: Error) => void): unknown;
};

export function createRuntimeLifecycle(opts: {
  db: Database;
  sessionManager: SessionManager;
  logger: Logger;
  getServer: () => ClosableServer | undefined;
  spawnArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  exit?: (code: number) => never;
}) {
  let shuttingDown = false;
  const exit = opts.exit ?? process.exit;

  async function stop(mode: RuntimeStopMode): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    const restarting = mode === 'restart';
    opts.logger.warn(restarting ? 'runtime_restart_requested' : 'runtime_shutdown_requested', {
      source: 'runtime',
    });
    console.log(restarting ? '\nRestarting runtime...' : '\nShutting down...');

    const server = opts.getServer();
    if (server) {
      await new Promise<void>((resolveClose) => {
        server.close((err?: Error) => {
          if (err) {
            opts.logger.warn('http_server_close_failed', {
              error: err.message,
            });
          }
          resolveClose();
        });
      });
    }

    try {
      await opts.sessionManager.shutdown();
    } catch (err: any) {
      opts.logger.error('session_manager_shutdown_failed', {
        error: err?.message ?? String(err),
      });
    }
    opts.db.close();

    if (restarting) {
      try {
        const child = spawn(process.execPath, opts.spawnArgs ?? process.argv.slice(1), {
          cwd: opts.cwd ?? process.cwd(),
          env: opts.env ?? process.env,
          stdio: 'ignore',
          detached: true,
        });
        child.unref();
      } catch (err: any) {
        opts.logger.error('runtime_restart_spawn_failed', {
          error: err?.message ?? String(err),
        });
        exit(1);
      }
    }

    exit(0);
  }

  return { stop };
}
