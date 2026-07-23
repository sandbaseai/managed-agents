import { Copy } from 'lucide-react';
import { copyText } from '../../../lib/format';
import type { ApiReferenceEndpoint, ApiReferenceField } from './apiReferenceTypes';

export function ApiParamSection({
  title,
  fields,
  emptyLabel,
  response,
}: {
  title: string;
  fields: ApiReferenceField[];
  emptyLabel: string;
  response?: boolean;
}) {
  return (
    <section className="apiDocsSection">
      <h3>{title}</h3>
      {fields.length > 0 ? (
        <div className="apiParamList">
          {fields.map((field) => (
            <div className="apiParamRow" key={field.name}>
              <div>
                <strong>{field.name}</strong>
                {response ? <span>{field.type}</span> : <span>{field.required ? 'required' : 'optional'}</span>}
              </div>
              <p>{response ? field.description : <><code>{field.type}</code> {field.description}</>}</p>
            </div>
          ))}
        </div>
      ) : <p className="apiEmptyState">{emptyLabel}</p>}
    </section>
  );
}

export function ApiCodeCard({
  title,
  code,
  copyLabel,
}: {
  title: string;
  code: string;
  copyLabel?: string;
}) {
  return (
    <div className="apiDocsCodeCard">
      <div className="snippetHeader">
        <h2>{title}</h2>
        {copyLabel ? (
          <button className="iconButton" type="button" title={copyLabel} aria-label={copyLabel} onClick={() => copyText(code)}>
            <Copy size={15} />
          </button>
        ) : null}
      </div>
      <pre className="metricsPreview apiSnippet">{code}</pre>
    </div>
  );
}

export function ApiMethodBadge({
  method,
  variant = 'pill',
}: {
  method: ApiReferenceEndpoint['method'];
  variant?: 'pill' | 'square';
}) {
  return <span className={`${variant === 'square' ? 'methodSquare' : 'methodPill'} method${method}`}>{method}</span>;
}
