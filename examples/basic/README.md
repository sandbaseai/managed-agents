# Basic Example

A minimal managed-agents setup with a single echo assistant.

## Setup

```bash
# Set your API key
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.openai.com/v1  # or http://localhost:11434/v1 for Ollama

# Start from this directory
cd examples/basic
npx managed-agents start --agents-dir agents --config managed-agents.config.yaml
```

## Usage

Once running, interact via the CMA-compatible API:

```bash
# Create a session
curl -X POST http://localhost:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"agent": "echo-assistant"}'

# Send a message (replace SESSION_ID)
curl -X POST http://localhost:3000/v1/sessions/SESSION_ID/events \
  -H "Content-Type: application/json" \
  -d '{"type": "user.message", "content": [{"type": "text", "text": "Hello!"}]}'

# Get events
curl http://localhost:3000/v1/sessions/SESSION_ID/events
```

## With @anthropic-ai/sdk

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'not-needed-for-local',
});

const session = await client.beta.sessions.create({
  agent: 'echo-assistant',
});

await client.beta.sessions.events.send(session.id, {
  events: [{ type: 'user.message', content: [{ type: 'text', text: 'Hello!' }] }],
});
```
