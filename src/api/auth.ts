/**
 * API Authentication Middleware
 *
 * Optional bearer-token auth. Local-first by default: if no API key is
 * configured, the server runs unauthenticated (suitable for localhost dev).
 * When one or more keys are configured (via config or MANAGED_AGENTS_API_KEY),
 * all /v1 routes require `Authorization: Bearer <key>`.
 *
 * Health check (/v1/x/health) and the root (/) are always public so liveness
 * probes and dashboards can reach them without a key.
 */

import type { MiddlewareHandler } from 'hono';

export interface AuthConfig {
  /** Accepted API keys. Empty/undefined = auth disabled (open). */
  apiKeys?: string[];
}

const PUBLIC_PATHS = new Set(['/', '/ui', '/v1/x/health', '/v1/x/metrics']);

export function createAuthMiddleware(config: AuthConfig): MiddlewareHandler {
  const keys = new Set((config.apiKeys ?? []).filter((k) => k && k.length > 0));
  const enabled = keys.size > 0;

  return async (c, next) => {
    if (!enabled) {
      return next();
    }

    // Always allow public liveness/root paths
    if (PUBLIC_PATHS.has(c.req.path)) {
      return next();
    }

    const header = c.req.header('Authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match?.[1]?.trim();

    if (!token || !keys.has(token)) {
      return c.json(
        {
          error: {
            type: 'authentication_error',
            message: 'Missing or invalid API key. Provide "Authorization: Bearer <key>".',
          },
        },
        401,
      );
    }

    return next();
  };
}

/**
 * Resolve API keys from config + environment.
 * Env var MANAGED_AGENTS_API_KEY (comma-separated) is merged with config keys.
 */
export function resolveApiKeys(configKeys?: string[]): string[] {
  const keys = new Set<string>(configKeys ?? []);
  const envKeys = process.env['MANAGED_AGENTS_API_KEY'];
  if (envKeys) {
    for (const k of envKeys.split(',').map((s) => s.trim()).filter(Boolean)) {
      keys.add(k);
    }
  }
  return Array.from(keys);
}
