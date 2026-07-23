import { DefaultStrategy } from '@/strategy/default-strategy.js';
import type { RuntimeSettings } from '@/core/settings/schema.js';
import type { AgentStrategy } from '@/types/strategy.js';

export interface RuntimeLoopEngine {
  strategy: AgentStrategy;
  defaultMaxSteps: number;
}

export function bootstrapRuntimeLoopEngine(settings: RuntimeSettings): RuntimeLoopEngine {
  if (settings.loop_engine.provider !== 'builtin') {
    throw new Error(`Loop engine "${settings.loop_engine.provider}" is not available`);
  }
  return {
    strategy: new DefaultStrategy(),
    defaultMaxSteps: settings.loop_engine.options.default_max_steps,
  };
}
