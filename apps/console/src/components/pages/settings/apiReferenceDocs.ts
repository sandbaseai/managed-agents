import type { ApiReferenceEndpoint } from './apiReferenceTypes';
import sessions from './api-reference/sessions.json';
import agents from './api-reference/agents.json';
import skills from './api-reference/skills.json';
import files from './api-reference/files.json';
import environments from './api-reference/environments.json';
import credential_vaults from './api-reference/credential-vaults.json';
import memory_stores from './api-reference/memory-stores.json';
import runtime_settings from './api-reference/runtime-settings.json';
import api_keys from './api-reference/api-keys.json';
import operations from './api-reference/operations.json';
import worker from './api-reference/worker.json';

export const API_REFERENCE_DOCS: ApiReferenceEndpoint[] = [
  ...(sessions as unknown as ApiReferenceEndpoint[]),
  ...(agents as unknown as ApiReferenceEndpoint[]),
  ...(skills as unknown as ApiReferenceEndpoint[]),
  ...(files as unknown as ApiReferenceEndpoint[]),
  ...(environments as unknown as ApiReferenceEndpoint[]),
  ...(credential_vaults as unknown as ApiReferenceEndpoint[]),
  ...(memory_stores as unknown as ApiReferenceEndpoint[]),
  ...(runtime_settings as unknown as ApiReferenceEndpoint[]),
  ...(api_keys as unknown as ApiReferenceEndpoint[]),
  ...(operations as unknown as ApiReferenceEndpoint[]),
  ...(worker as unknown as ApiReferenceEndpoint[]),
];
