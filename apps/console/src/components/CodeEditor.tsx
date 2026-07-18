import type { UIEvent } from 'react';

export function JsonCodeEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <CodeEditor value={value} onChange={onChange} language="json" />;
}

export function CodeEditor({
  value,
  onChange,
  language,
  minRows,
}: {
  value: string;
  onChange: (value: string) => void;
  language: 'json' | 'yaml';
  minRows?: number;
}) {
  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const highlight = event.currentTarget.previousElementSibling;
    if (!(highlight instanceof HTMLElement)) return;
    highlight.scrollTop = event.currentTarget.scrollTop;
    highlight.scrollLeft = event.currentTarget.scrollLeft;
  };

  return (
    <div className="codeEditorShell">
      <pre className="codeEditorHighlight" aria-hidden="true">{language === 'json' ? highlightJson(value) : highlightYaml(value)}</pre>
      <textarea
        className="codeEditorInput"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={handleScroll}
        rows={minRows}
        spellCheck={false}
      />
    </div>
  );
}

export function highlightJson(value: string) {
  const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const nodes: Array<string | JSX.Element> = [];
  let lastIndex = 0;

  for (const match of value.matchAll(tokenPattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index));

    const token = match[0];
    const className = match[1] ? 'jsonKey'
      : match[2] ? 'jsonString'
        : match[3] ? 'jsonBoolean'
          : match[4] ? 'jsonNull'
            : 'jsonNumber';

    nodes.push(<span className={className} key={`${match.index}-${token}`}>{token}</span>);
    lastIndex = match.index + token.length;
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes.length > 0 ? nodes : value;
}

export function highlightYaml(value: string) {
  const tokenPattern = /(^\s*[-]?\s*)([A-Za-z_][\w-]*)(\s*:)|("(?:\\.|[^"\\])*"|'(?:''|[^'])*')|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/gmi;
  const nodes: Array<string | JSX.Element> = [];
  let lastIndex = 0;

  for (const match of value.matchAll(tokenPattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index));

    const token = match[0];
    if (match[2]) {
      nodes.push(match[1] ?? '');
      nodes.push(<span className="yamlKey" key={`${match.index}-${match[2]}`}>{match[2]}</span>);
      nodes.push(match[3] ?? '');
    } else {
      const className = match[4] ? 'yamlString'
        : match[5] ? 'yamlBoolean'
          : match[6] ? 'yamlNull'
            : 'yamlNumber';
      nodes.push(<span className={className} key={`${match.index}-${token}`}>{token}</span>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes.length > 0 ? nodes : value;
}
