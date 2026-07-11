# Contributing to managed-agents

## Development Workflow

1. Fork the repository
2. Create a feature branch from `main`: `git checkout -b feat/my-feature`
3. Make your changes
4. Ensure all checks pass: `npm run lint && npm run typecheck && npm run test`
5. Commit with conventional commits: `feat: add session resume`
6. Push and open a Pull Request against `main`

## Branch Strategy

- `main` — stable, protected, requires PR review + CI pass
- `feat/*` — new features
- `fix/*` — bug fixes
- `docs/*` — documentation changes
- `refactor/*` — code restructuring

## Code Standards

### Language

- **All code, comments, variable names, and documentation MUST be in English.**
- No Chinese characters allowed in any source file (enforced by CI).

### Style

- TypeScript strict mode
- ESLint + Prettier for formatting
- Conventional Commits for commit messages

### Commit Message Format

```
<type>(<scope>): <description>

[optional body]
[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

## PR Requirements

- All CI checks must pass (lint, typecheck, test, build, no-chinese)
- PR title must follow conventional commit format
- At least 1 approval required for merge to `main`

## Project Structure

```
managed-agents/
├── packages/
│   ├── core/           # Session manager, event log, agent loader
│   ├── sandbox/        # Sandbox provider interface + local impl
│   ├── models/         # Model adapter (Ollama/OpenAI/Anthropic)
│   ├── mcp/            # MCP client manager
│   ├── api/            # Hono HTTP routes (CMA-compatible)
│   └── shared/         # Types, utils, constants
├── apps/
│   ├── server/         # Single-process entry point
│   ├── cli/            # CLI tool (Commander.js)
│   └── dashboard/      # React + Vite web UI
└── templates/          # Built-in scenario templates
```
