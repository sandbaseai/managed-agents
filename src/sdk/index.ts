/**
 * managed-agents SDK — public client entry point.
 *
 * Usage:
 *   import { ManagedAgentsClient } from 'managed-agents/sdk';
 *   const client = new ManagedAgentsClient({ baseUrl: 'http://localhost:3000' });
 *   const session = await client.sessions.create({ agent: 'assistant' });
 *   for await (const ev of client.sessions.chat(session.id, 'hello')) {
 *     if (ev.type === 'agent.message_chunk') process.stdout.write(ev.delta ?? '');
 *   }
 */

export {
  ManagedAgentsClient,
  ManagedAgentsApiError,
  type ClientOptions,
  type SessionSummary,
  type StreamedEvent,
} from './client.js';
