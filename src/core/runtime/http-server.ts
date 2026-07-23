export interface RuntimeStartupBannerOptions {
  version: string;
  host: string;
  port: number;
  agentsCount: number;
  skillsCount: number;
  sandboxProviders: string[];
  memory: string;
  target: string;
  dataDir: string;
  authEnabled: boolean;
  agentLoadErrorCount: number;
}

export interface RuntimeErrorServer {
  on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): void;
}

export interface RuntimeServerErrorHandlerOptions {
  server: RuntimeErrorServer;
  port: number;
  db: { close(): void };
  writeError?: (message: string) => void;
  exit?: (code: number) => never;
}

export function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function runtimeStartupBannerLines(options: RuntimeStartupBannerOptions): string[] {
  const lines = [
    `\n  managed-agents v${options.version}\n`,
    `  API:       http://${options.host}:${options.port}/v1`,
    `  Dashboard: http://${options.host}:${options.port}/dashboard`,
    `  Health:    http://${options.host}:${options.port}/v1/x/health`,
    `  Agents:    ${options.agentsCount} loaded`,
    `  Skills:    ${options.skillsCount} loaded`,
    `  Sandbox:   ${options.sandboxProviders.join(', ')}`,
    `  Memory:    ${options.memory}`,
    `  Target:    ${options.target}`,
    `  Data:      ${options.dataDir}`,
    `  Auth:      ${options.authEnabled ? 'enabled (Bearer token required)' : 'DISABLED (open - localhost only)'}`,
  ];
  if (options.agentLoadErrorCount > 0) {
    lines.push(`  Warnings:  ${options.agentLoadErrorCount} agent load errors`);
  }
  lines.push('');
  return lines;
}

export function attachRuntimeServerErrorHandler(options: RuntimeServerErrorHandlerOptions): void {
  const {
    server,
    port,
    db,
    writeError = console.error,
    exit = process.exit,
  } = options;

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      writeError(`Error: [PORT_IN_USE] Port ${port} is already in use.`);
      writeError('  -> Stop the process using it, or start with --port <other>');
    } else {
      writeError(`Error: [SERVER] ${err.message}`);
    }
    db.close();
    exit(1);
  });
}
