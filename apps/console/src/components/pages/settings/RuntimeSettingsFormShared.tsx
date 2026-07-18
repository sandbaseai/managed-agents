import type { RuntimeSettingsConfig } from '../../../types';

export type AdapterOption = {
  id: string;
  label: string;
  status: 'available' | 'unavailable' | 'invalid';
  options_schema?: Record<string, unknown>;
};

export type SettingsFormProps = {
  adapters: AdapterOption[];
  config: RuntimeSettingsConfig;
  onChange: (config: RuntimeSettingsConfig) => void;
  errors?: Record<string, string>;
  resetKey?: number;
};

export function AdapterSelect({
  adapters,
  value,
  onChange,
}: {
  adapters: AdapterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {adapters.map((item) => (
        <option key={item.id} value={item.id} disabled={item.status !== 'available'}>
          {item.label}{item.status === 'available' ? '' : ` - ${item.status}`}
        </option>
      ))}
    </select>
  );
}

export function optionDefaultsForAdapter(
  adapters: Array<{ id: string; options_schema?: Record<string, unknown> }>,
  id: string,
): Record<string, unknown> {
  const schema = adapters.find((adapter) => adapter.id === id)?.options_schema;
  if (!schema || typeof schema !== 'object') return {};
  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};
  return Object.fromEntries(Object.entries(properties as Record<string, unknown>).flatMap(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('default' in value)) return [];
    return [[key, (value as { default: unknown }).default]];
  }));
}
