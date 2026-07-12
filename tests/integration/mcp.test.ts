/**
 * Integration test: MCP client integration (Requirement 5).
 *
 * Verifies:
 * - stdio MCP server tools are discovered and namespaced
 * - degraded mode: a server that fails to connect is skipped, not fatal (R5.5)
 * - empty config → empty tool set
 * - close() tears down connections
 */

import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { McpManager, reconnectDelay } from '@/core/mcp/mcp-manager.js';
import type { McpServerConfig } from '@/types/agent.js';

const MOCK_SERVER = join(import.meta.dirname, '../fixtures/mock-mcp-server.mjs');

describe('MCP integration', () => {
  let manager: McpManager;

  afterEach(async () => {
    if (manager) await manager.close();
  });

  it('returns empty tools for empty server list', async () => {
    manager = new McpManager();
    const tools = await manager.connectAll([]);
    expect(Object.keys(tools)).toHaveLength(0);
  });

  it('discovers and namespaces tools from a stdio MCP server', async () => {
    manager = new McpManager();
    const servers: McpServerConfig[] = [
      { name: 'mock', type: 'stdio', command: 'node', args: [MOCK_SERVER] },
    ];
    const tools = await manager.connectAll(servers);

    // Tool should be namespaced mcp_<server>_<tool>
    expect(tools['mcp_mock_echo']).toBeDefined();

    const statuses = manager.getStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].connected).toBe(true);
    expect(statuses[0].toolCount).toBe(1);
  });

  it('degrades gracefully when a server fails to connect (R5.5)', async () => {
    manager = new McpManager();
    const servers: McpServerConfig[] = [
      { name: 'broken', type: 'stdio', command: 'this-command-does-not-exist-xyz', args: [], timeout: 3 },
    ];
    // Must NOT throw
    const tools = await manager.connectAll(servers);
    expect(Object.keys(tools)).toHaveLength(0);

    const statuses = manager.getStatuses();
    expect(statuses[0].connected).toBe(false);
    expect(statuses[0].error).toBeTruthy();
  });

  it('keeps working servers when one fails (partial degradation)', async () => {
    manager = new McpManager();
    const servers: McpServerConfig[] = [
      { name: 'broken', type: 'stdio', command: 'nonexistent-xyz', args: [], timeout: 3 },
      { name: 'mock', type: 'stdio', command: 'node', args: [MOCK_SERVER] },
    ];
    const tools = await manager.connectAll(servers);

    // The good server's tool is present despite the broken one
    expect(tools['mcp_mock_echo']).toBeDefined();

    const statuses = manager.getStatuses();
    expect(statuses.find((s) => s.name === 'broken')!.connected).toBe(false);
    expect(statuses.find((s) => s.name === 'mock')!.connected).toBe(true);
  });

  it('rejects stdio config missing command / http config missing url', async () => {
    manager = new McpManager();
    const tools = await manager.connectAll([
      { name: 'bad-stdio', type: 'stdio' } as McpServerConfig,
      { name: 'bad-http', type: 'url' } as McpServerConfig,
    ]);
    expect(Object.keys(tools)).toHaveLength(0);
    const statuses = manager.getStatuses();
    expect(statuses.every((s) => !s.connected)).toBe(true);
  });

  describe('reconnect backoff (R5.6)', () => {
    it('uses exponential backoff capped at 60s', () => {
      expect(reconnectDelay(0)).toBe(1000);
      expect(reconnectDelay(1)).toBe(2000);
      expect(reconnectDelay(2)).toBe(4000);
      expect(reconnectDelay(3)).toBe(8000);
      expect(reconnectDelay(4)).toBe(16000);
      expect(reconnectDelay(10)).toBe(60000); // capped
    });

    it('reconnects a known server and re-registers its tools', async () => {
      manager = new McpManager();
      // First connect the mock server
      await manager.connectAll([
        { name: 'mock', type: 'stdio', command: 'node', args: [MOCK_SERVER] },
      ]);

      // Simulate a reconnect (no real drop; verifies the reconnect path works)
      const delays: number[] = [];
      const tools = await manager.reconnect('mock', async (ms) => { delays.push(ms); });
      expect(tools).not.toBeNull();
      expect(tools!['mcp_mock_echo']).toBeDefined();
    });

    it('returns null for an unknown server', async () => {
      manager = new McpManager();
      const tools = await manager.reconnect('nonexistent', async () => {});
      expect(tools).toBeNull();
    });

    it('auto-reconnects and retries a tool call when the connection drops (L5)', async () => {
      manager = new McpManager();
      manager.setSleepFn(async () => {}); // no real backoff sleeps in test
      const tools = await manager.connectAll([
        { name: 'mock', type: 'stdio', command: 'node', args: [MOCK_SERVER] },
      ]);

      const echo = tools['mcp_mock_echo'] as { execute: (a: any) => Promise<any> };
      expect(echo).toBeDefined();

      // Monkey-patch the live tool to throw a connection error on first call,
      // then succeed — the wrapper should reconnect and retry transparently.
      const live = (manager as any).liveTools.get('mock');
      const original = live.echo.execute;
      let calls = 0;
      live.echo.execute = async (args: any) => {
        calls++;
        if (calls === 1) throw new Error('socket closed');
        return original(args);
      };

      const result = await echo.execute({ text: 'hi' });
      // After reconnect, the fresh tool executes normally
      expect(JSON.stringify(result)).toContain('echo: hi');
    });

    it('retries with backoff then gives up on a permanently-broken server', async () => {
      manager = new McpManager();
      await manager.connectAll([
        { name: 'broken', type: 'stdio', command: 'nonexistent-xyz', args: [], timeout: 1 },
      ]);
      const delays: number[] = [];
      const tools = await manager.reconnect('broken', async (ms) => { delays.push(ms); });
      expect(tools).toBeNull();
      // 5 attempts → 4 backoff sleeps between them: 1s,2s,4s,8s
      expect(delays).toEqual([1000, 2000, 4000, 8000]);
      const status = manager.getStatuses().find((s) => s.name === 'broken');
      expect(status!.connected).toBe(false);
    });
  });
});
