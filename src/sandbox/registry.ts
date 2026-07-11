/**
 * Sandbox Provider Registry
 *
 * Maps a sandbox provider type (`local`, `docker`, ...) to its implementation.
 * The executor resolves a provider by an Environment's `sandbox_provider` type
 * (R12.3), so an agent can switch execution backends without code changes.
 *
 * If a requested provider type is not registered, a descriptive error is
 * thrown naming the missing dependency (R12.4).
 */

import type { SandboxProvider } from '@/types/sandbox.js';

export class SandboxProviderRegistry {
  private providers = new Map<string, SandboxProvider>();

  register(provider: SandboxProvider): void {
    this.providers.set(provider.type, provider);
  }

  has(type: string): boolean {
    return this.providers.has(type);
  }

  /**
   * Get a provider by type. Throws with an install hint if not registered.
   */
  get(type: string): SandboxProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      const available = Array.from(this.providers.keys()).join(', ') || 'none';
      throw new Error(
        `Sandbox provider "${type}" is not available (registered: ${available}). ` +
          hintForProvider(type),
      );
    }
    return provider;
  }

  listTypes(): string[] {
    return Array.from(this.providers.keys());
  }
}

function hintForProvider(type: string): string {
  switch (type) {
    case 'docker':
      return 'Install Docker and ensure the `docker` CLI is on PATH.';
    case 'e2b':
      return 'Install the E2B SDK and set E2B_API_KEY.';
    case 'daytona':
      return 'Install the Daytona SDK and configure credentials.';
    default:
      return 'Check your Environment sandbox_provider configuration.';
  }
}
