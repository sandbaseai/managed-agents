# managed-agents

Open-source CMA-compatible agent runtime. Run multi-agent systems locally with any model, MCP tools, scenario templates, and a beautiful dashboard.

> Run Claude Managed Agents locally. Any model. One command.

```bash
npx @sandbase/managed-agents start
```

## Features

🚀 **1 Minute Start** — Zero-config, single process, runs anywhere  
📦 **Scenario Templates** — Customer support, coding, research... install and go  
🧠 **Any Model** — Ollama / vLLM / Claude / GPT, local or cloud  
🔌 **MCP + Skills** — Standard protocol, connect any external tool  
🎨 **Dashboard** — Beautiful web UI for chat, monitoring, and configuration  
🔗 **CMA-Compatible API** — Use `@anthropic-ai/sdk` directly, switch to cloud anytime  
📁 **Git-Friendly** — Declarative YAML definitions, diff/review/CI ready  

## Quick Start

```bash
# Initialize a new project
npx @sandbase/managed-agents init

# Start the platform (API + Dashboard + Agent Runtime)
npx @sandbase/managed-agents start

# Open http://localhost:3000
```

## Comparison

| | Claude Managed Agents | OMA | Dify | **managed-agents** |
|---|---|---|---|---|
| Deploy | Anthropic cloud | CF Workers / Docker | Docker + Redis + PG | **`npx managed-agents start`** |
| Data | Anthropic servers | CF / your server | Your server | **Your laptop** |
| Models | Claude only | Claude + OpenAI compat | Multi-model | **Any (incl. Ollama local)** |
| Cost | Per-token pricing | Self-pay model fees | Self-pay model fees | **Local model = free** |
| Setup time | 10 min | 30 min+ | 1 hour+ | **1 minute** |
| Templates | ✗ | ✗ | Yes (workflow import) | **✓ One-click install** |
| CMA-compatible | Original | Fully compatible | ✗ | **Fully compatible** |
| Dashboard | ✗ (API only) | Console | Yes | **✓ Beautiful built-in** |

## Documentation

- [Requirements](/docs/requirements.md)
- [Technical Design](/docs/design.md)
- [Architecture Diagrams](/docs/architecture.md)

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE)
