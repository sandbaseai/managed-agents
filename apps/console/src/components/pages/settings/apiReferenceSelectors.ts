import type { ApiReferenceEndpoint, ApiReferenceField } from './apiReferenceTypes';

export function getVisibleApiEndpoints(docs: ApiReferenceEndpoint[], search: string) {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return docs;

  return docs.filter((endpoint) => [
    endpoint.group,
    endpoint.title,
    endpoint.method,
    endpoint.path,
    endpoint.summary,
  ].join(' ').toLowerCase().includes(normalizedSearch));
}

export function getEndpointGroups(docs: ApiReferenceEndpoint[]) {
  return Array.from(new Set(docs.map((endpoint) => endpoint.group)));
}

export function selectVisibleApiEndpoint(
  visibleDocs: ApiReferenceEndpoint[],
  activeEndpointId: string,
): ApiReferenceEndpoint | undefined {
  return visibleDocs.find((endpoint) => endpoint.id === activeEndpointId) ?? visibleDocs[0];
}

export function buildDefaultHeaders(endpoint: ApiReferenceEndpoint, authEnabled: boolean): ApiReferenceField[] {
  return [
    {
      name: 'Content-Type',
      type: 'application/json',
      description: 'Required for JSON request bodies.',
      required: endpoint.method !== 'GET',
    },
    {
      name: 'Authorization',
      type: 'Bearer token',
      description: authEnabled
        ? 'Required when local API authentication is enabled.'
        : 'Optional while local API authentication is disabled.',
    },
    {
      name: 'anthropic-beta',
      type: 'string',
      description: 'Accepted for Claude Managed Agents-compatible clients.',
    },
  ];
}
