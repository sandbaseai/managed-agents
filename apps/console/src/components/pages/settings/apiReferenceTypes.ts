export type ApiReferenceField = {
  name: string;
  type: string;
  description: string;
  required?: boolean;
};

export type ApiReferenceEndpoint = {
  id: string;
  group: string;
  title: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  summary: string;
  headers?: ApiReferenceField[];
  parameters?: ApiReferenceField[];
  response: ApiReferenceField[];
};
