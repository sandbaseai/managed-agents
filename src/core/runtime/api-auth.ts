import type { Database } from '../db/database.js';
import { resolveApiKeys } from '../../api/auth.js';
import { countActiveManagedApiKeys, validateManagedApiKey } from '../auth/api-keys.js';

export interface RuntimeApiAuthOptions {
  db: Database;
}

export interface RuntimeApiAuth {
  apiKeys: string[];
  hasApiKeys: () => boolean;
  validateApiKey: (key: string) => boolean;
}

export function resolveRuntimeApiAuth(options: RuntimeApiAuthOptions): RuntimeApiAuth {
  const apiKeys = resolveApiKeys();

  return {
    apiKeys,
    hasApiKeys: () => apiKeys.length > 0 || countActiveManagedApiKeys(options.db) > 0,
    validateApiKey: (key: string) => apiKeys.includes(key) || validateManagedApiKey(options.db, key),
  };
}
