/**
 * Sandbox Provider Types
 *
 * Pluggable execution backend interface for running tool commands.
 * Session state machine and Sandbox are separate concerns — the Session
 * owns the control plane (Event_Log, status), the Sandbox owns the
 * execution plane (file system, process execution).
 */

// ============================================================
// Sandbox Provider Interface
// ============================================================

export interface SandboxProvider {
  readonly type: string; // 'local' | 'docker' | 'e2b' | 'daytona' | 'self_hosted'

  /** Create and initialize a Sandbox instance bound to a session */
  provision(
    sessionId: string,
    config: EnvironmentConfig,
  ): Promise<SandboxInstance>;
}

// ============================================================
// Sandbox Instance Interface
// ============================================================

export interface SandboxInstance {
  readonly sessionId: string;

  /** Execute a shell command */
  execute(command: string, options?: ExecOptions): Promise<ExecResult>;

  /** Write a file (relative to working directory) */
  writeFile(path: string, content: string | Buffer): Promise<void>;

  /** Read a file (relative to working directory) */
  readFile(path: string): Promise<string>;

  /** List files in a directory (relative to working directory) */
  listFiles(path: string): Promise<string[]>;

  /**
   * Local host path of the working directory, if this provider is backed by a
   * host filesystem (local subprocess). Undefined for providers whose file
   * system isn't directly host-accessible (e.g. docker). Used for workspace
   * snapshots (R9.11).
   */
  readonly hostWorkDir?: string;

  /** Release all resources (remove working directory, kill processes) */
  cleanup(): Promise<void>;
}

// ============================================================
// Execution Options & Result
// ============================================================

export interface ExecOptions {
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
  /** Working directory (relative to sandbox root) */
  cwd?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

// ============================================================
// Environment Configuration
// ============================================================

export type SandboxProviderType =
  | 'local'
  | 'docker'
  | 'e2b'
  | 'daytona'
  | 'self_hosted';

export interface EnvironmentConfig {
  name: string;
  sandbox_provider: SandboxProviderType;
  /** Default timeout in seconds (default: 300) */
  timeout?: number;
  /** Resource limits (for providers that support them) */
  resources?: {
    memory?: string; // e.g. '512m'
    cpu?: number; // e.g. 1.0
  };
  /** Workspace snapshot configuration */
  snapshot?: {
    enabled: boolean;
    interval_seconds?: number;
  };
  /** Docker image (docker provider only) */
  image?: string;
  /** API key (E2B/Daytona providers) */
  api_key?: string;
  /** Template ID (E2B/Daytona providers) */
  template_id?: string;
}
