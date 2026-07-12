# Basic Example

A minimal managed-agents setup with a single echo assistant.

## Setup

```bash
# Start from this directory
cd examples/basic
npx managed-agents start --agents-dir agents --config managed-agents.config.yaml
```

Configure model credentials in `managed-agents.config.yaml` before calling a
real hosted or local model.

## Usage

Once running, interact with the local API:

```bash
# Create a session
curl -X POST http://localhost:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"agent": "echo-assistant"}'

# Send a message and stream the turn (replace SESSION_ID)
curl -N -X POST http://localhost:3000/v1/sessions/SESSION_ID/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello!"}'

# Get events
curl http://localhost:3000/v1/sessions/SESSION_ID/events
```

For lower-level event-driven integrations, `POST /v1/sessions/:id/events`
also accepts explicit `user.*` events.

## With the TypeScript SDK

```typescript
import { ManagedAgentsClient } from 'managed-agents/sdk';

const client = new ManagedAgentsClient({
  baseUrl: 'http://localhost:3000/v1',
  apiKey: 'not-needed-for-local',
});

const session = await client.sessions.create({
  agent: 'echo-assistant',
});

await client.sessions.message(session.id, 'Hello!', { stream: false });
```
