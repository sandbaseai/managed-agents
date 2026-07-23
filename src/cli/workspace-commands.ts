import {
  createRegisteredWorkspace,
  listRegisteredWorkspaces,
  registerWorkspace,
  removeRegisteredWorkspace,
  resolveRegisteredWorkspace,
  type WorkspaceRegistryEntry,
} from '@/core/workspace/registry.js';

export type WorkspaceCommandOptions = {
  name?: string;
  dataDir?: string;
  json?: boolean;
};

export function workspaceListCommand(opts: { json?: boolean }) {
  const workspaces = listRegisteredWorkspaces();
  if (opts.json) return printJson(workspaces);
  if (workspaces.length === 0) {
    console.log('No workspaces registered.');
    return;
  }
  for (const workspace of workspaces) console.log(formatWorkspace(workspace));
}

export function workspaceCreateCommand(root: string, opts: WorkspaceCommandOptions) {
  const workspace = createRegisteredWorkspace({
    root,
    name: opts.name,
    dataDir: opts.dataDir,
  });
  if (opts.json) return printJson(workspace);
  console.log(`Created workspace: ${formatWorkspace(workspace)}`);
}

export function workspaceOpenCommand(root: string, opts: WorkspaceCommandOptions) {
  const workspace = registerWorkspace({
    root,
    name: opts.name,
    dataDir: opts.dataDir,
  });
  if (opts.json) return printJson(workspace);
  console.log(`Registered workspace: ${formatWorkspace(workspace)}`);
}

export function workspaceResolveCommand(idOrNameOrRoot: string, opts: { json?: boolean }) {
  const workspace = resolveRegisteredWorkspace(idOrNameOrRoot);
  if (!workspace) {
    console.error(`Workspace not found: ${idOrNameOrRoot}`);
    process.exitCode = 1;
    return;
  }
  if (opts.json) return printJson(workspace);
  console.log(formatWorkspace(workspace));
}

export function workspaceRemoveCommand(idOrNameOrRoot: string) {
  const removed = removeRegisteredWorkspace(idOrNameOrRoot);
  if (!removed) {
    console.error(`Workspace not found: ${idOrNameOrRoot}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Removed workspace: ${idOrNameOrRoot}`);
}

function formatWorkspace(workspace: WorkspaceRegistryEntry): string {
  return `${workspace.id}  ${workspace.name}  ${workspace.root}  data=${workspace.data_dir}`;
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
