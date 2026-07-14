/**
 * API Authentication Middleware
 *
 * Optional bearer-token auth. Local-first by default: if no API key is
 * configured, the server runs unauthenticated (suitable for localhost dev).
 * When one or more keys are configured (via config or MANAGED_AGENTS_API_KEY),
 * all /v1 routes require `Authorization: Bearer <key>`.
 *
 * Health check (/v1/x/health), metrics, and the dashboard shell (/dashboard and its
 * static assets) are public so liveness probes and the browser app can load
 * before it has a stored API key. Data APIs still require Bearer auth.
 */

import type { MiddlewareHandler } from 'hono';

export interface AuthConfig {
  /** Accepted API keys. Empty/undefined = auth disabled (open). */
  apiKeys?: string[];
  /** Dynamic key presence check, used for database-managed API keys. */
  hasApiKeys?: () => boolean;
  /** Dynamic key validator, used for database-managed API keys. */
  validateApiKey?: (key: string) => boolean;
}

const PUBLIC_PATHS = new Set(['/', '/dashboard', '/ui', '/v1/x/health', '/v1/x/metrics']);

export function createAuthMiddleware(config: AuthConfig): MiddlewareHandler {
  const keys = new Set((config.apiKeys ?? []).filter((k) => k && k.length > 0));

  return async (c, next) => {
    const enabled = keys.size > 0 || Boolean(config.hasApiKeys?.());
    if (!enabled) {
      return next();
    }

    // Always allow public liveness/root paths and the static console shell.
    if (PUBLIC_PATHS.has(c.req.path) || c.req.path.startsWith('/dashboard/') || c.req.path.startsWith('/ui/')) {
      return next();
    }

    const header = c.req.header('Authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match?.[1]?.trim();

    const valid = token ? keys.has(token) || Boolean(config.validateApiKey?.(token)) : false;
    if (!valid) {
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
