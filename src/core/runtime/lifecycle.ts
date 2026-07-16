import { spawn as nodeSpawn } from 'node:child_process';
import type { Logger } from '../observability/logger.js';

export type RuntimeStopMode = 'shutdown' | 'restart';

export interface ClosableServer {
  close(callback: (err?: Error) => void): void;
}

export interface RuntimeLifecycleSessionManager {
  shutdown(): Promise<void>;
}

export interface RuntimeLifecycleDatabase {
  close(): void;
}

export interface SpawnedProcess {
  unref(): void;
}

export interface RuntimeLifecycleOptions {
  getServer: () => ClosableServer | undefined;
  sessionManager: RuntimeLifecycleSessionManager;
  db: RuntimeLifecycleDatabase;
  logger: Logger;
  execPath?: string;
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  exit?: (code: number) => never;
  spawn?: (command: string, args: string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: 'ignore';
    detached: true;
  }) => SpawnedProcess;
}

export type RuntimeStopper = (mode: RuntimeStopMode) => Promise<void>;

export function createRuntimeStopper(options: RuntimeLifecycleOptions): RuntimeStopper {
  const {
    getServer,
    sessionManager,
    db,
    logger,
    execPath = process.execPath,
    argv = process.argv,
    cwd = process.cwd(),
    env = process.env,
    log = console.log,
    exit = process.exit,
    spawn = nodeSpawn,
  } = options;
  let shuttingDown = false;

  return async (mode) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const restarting = mode === 'restart';
    logger.warn(restarting ? 'runtime_restart_requested' : 'runtime_shutdown_requested', {
      source: 'runtime',
    });
    log(restarting ? '\nRestarting runtime...' : '\nShutting down...');

    await closeServer(getServer(), logger);

    try {
      await sessionManager.shutdown();
    } catch (err: any) {
      logger.error('session_manager_shutdown_failed', {
        error: err?.message ?? String(err),
      });
    }

    db.close();

    if (restarting) {
      try {
        const child = spawn(execPath, argv.slice(1), {
          cwd,
          env,
          stdio: 'ignore',
          detached: true,
        });
        child.unref();
      } catch (err: any) {
        logger.error('runtime_restart_spawn_failed', {
          error: err?.message ?? String(err),
        });
        exit(1);
      }
    }

    exit(0);
  };
}

async function closeServer(server: ClosableServer | undefined, logger: Logger): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => {
    server.close((err?: Error) => {
      if (err) {
        logger.warn('http_server_close_failed', {
          error: err.message,
        });
      }
      resolve();
    });
  });
}
