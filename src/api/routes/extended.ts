/**
 * Extension Routes (/v1/x/*)
 *
 * Runtime extension composition root.
 */

import { Hono } from 'hono';
import type { ServerDeps } from '../server.js';
import { legacyProviderRoutes } from './legacy-providers.js';
import { runtimeRoutes } from './runtime.js';
import { settingsRoutes } from './settings.js';
import { templateRoutes } from './templates.js';

export function extendedRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.route('/', runtimeRoutes(deps));
  app.route('/', legacyProviderRoutes(deps));
  app.route('/settings', settingsRoutes(deps));
  app.route('/templates', templateRoutes(deps));

  return app;
}
