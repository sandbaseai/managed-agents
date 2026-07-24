import type { EnvironmentConfig, SandboxProviderType } from '@/types/sandbox.js';

export function normalizeRuntimeEnvironment(row: { id: string; name: string; config: string }): EnvironmentConfig {
  const parsed = parseJsonObject(row.config);
  const sandboxProvider = parseSandboxProvider(parsed.sandbox_provider)
    ?? (parsed.hosting_type === 'self_hosted' ? 'self_hosted' : 'local');

  return {
    ...parsed,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : row.name || row.id,
    sandbox_provider: sandboxProvider,
    timeout: typeof parsed.timeout === 'number' ? parsed.timeout : 300,
  };
}

function parseSandboxProvider(value: unknown): SandboxProviderType | undefined {
  return value === 'local'
    || value === 'docker'
    || value === 'e2b'
    || value === 'daytona'
    || value === 'self_hosted'
    ? value
    : undefined;
}

function parseJsonObject(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
