import type { AgentDefinition, AgentToolConfig, BuiltinAgentToolset, PermissionPolicyType } from '@/types/agent.js';

export const DEFAULT_AGENT_TOOLSET_TYPE = 'agent_toolset_20260401';

export function getAgentSkillIds(agent: AgentDefinition): string[] {
  return (agent.skills ?? []).map((skill) => skill.skill_id);
}

export function getEnabledToolNames(agent: AgentDefinition): string[] {
  const names = new Set<string>();
  for (const toolset of getAgentToolsets(agent)) {
    const defaultEnabled = toolset.default_config?.enabled !== false;
    for (const config of toolset.configs ?? []) {
      const enabled = config.enabled ?? defaultEnabled;
      if (enabled && getPermissionPolicy(config, toolset.default_config) !== 'never_allow') {
        names.add(config.name);
      }
    }
  }
  return [...names];
}

export function getToolPermission(agent: AgentDefinition, toolName: string): PermissionPolicyType {
  for (const toolset of getAgentToolsets(agent)) {
    const config = toolset.configs?.find((item) => item.name === toolName);
    if (!config) continue;
    return getPermissionPolicy(config, toolset.default_config);
  }
  return 'always_allow';
}

export function getToolsRequiringConfirmation(agent: AgentDefinition): string[] {
  return getEnabledToolNames(agent).filter((toolName) => getToolPermission(agent, toolName) === 'always_ask');
}

export function getAgentToolsets(agent: AgentDefinition): BuiltinAgentToolset[] {
  return (agent.tools ?? []).filter((toolset) => toolset.type === DEFAULT_AGENT_TOOLSET_TYPE);
}

function getPermissionPolicy(
  config: AgentToolConfig | undefined,
  defaultConfig: AgentToolConfig | undefined,
): PermissionPolicyType {
  return config?.permission_policy?.type ?? defaultConfig?.permission_policy?.type ?? 'always_allow';
}
