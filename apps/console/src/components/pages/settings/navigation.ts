import { Activity, Box, Brain, Database, FileText, Gauge, Keyboard, KeyRound, Settings, Shield } from 'lucide-react';
import type { ViewId } from '../../../types';

export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: Settings, group: 'Project' },
  { id: 'workspace', label: 'Workspace', icon: Box, group: 'Project' },
  { id: 'models', label: 'Models', icon: Brain, group: 'Runtime' },
  { id: 'loop-engine', label: 'Loop engine', icon: Gauge, group: 'Runtime' },
  { id: 'storage', label: 'Storage', icon: Database, group: 'Runtime' },
  { id: 'memory', label: 'Memory', icon: Brain, group: 'Runtime' },
  { id: 'sandbox', label: 'Sandbox', icon: Shield, group: 'Runtime' },
  { id: 'api-keys', label: 'API keys', icon: KeyRound, group: 'Access' },
  { id: 'api-reference', label: 'API reference', icon: Keyboard, group: 'Developer' },
  { id: 'logs', label: 'Logs', icon: FileText, group: 'Operations' },
  { id: 'monitoring', label: 'Monitoring', icon: Activity, group: 'Operations' },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];
export const SETTINGS_GROUPS = ['Project', 'Runtime', 'Access', 'Developer', 'Operations'] as const;
export const SETTINGS_VIEW_IDS: ViewId[] = [
  'settings', 'workspace', 'runtime', 'models', 'loop-engine', 'storage',
  'memory', 'sandbox', 'api-keys', 'api-reference', 'logs', 'monitoring', 'observability',
];
