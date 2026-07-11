#!/usr/bin/env node
/**
 * Minimal MCP stdio server for tests.
 *
 * Implements just enough of the MCP JSON-RPC protocol over newline-delimited
 * stdio to satisfy the Vercel AI SDK MCP client: initialize, tools/list,
 * tools/call. Exposes a single `echo` tool.
 */

import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method } = req;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-mcp', version: '1.0.0' },
      },
    });
    return;
  }

  // notifications have no id and need no response
  if (method === 'notifications/initialized' || id === undefined) {
    return;
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echo back the provided text',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        ],
      },
    });
    return;
  }

  if (method === 'tools/call') {
    const text = req.params?.arguments?.text ?? '';
    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `echo: ${text}` }],
      },
    });
    return;
  }

  // Unknown method
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
});
