import { Hono } from 'hono';
import type { ServerDeps } from '../server.js';
import { credentialVaultRoutes } from './credential-vaults.js';
import { environmentRoutes } from './environments.js';
import { fileRoutes } from './files.js';
import { memoryStoreRoutes } from './memory-stores.js';

export function resourceRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.route('/', environmentRoutes(deps));
  app.route('/', fileRoutes(deps));
  app.route('/', credentialVaultRoutes(deps));
  app.route('/', memoryStoreRoutes(deps));

  return app;
}
