# Contributing to managed-agents

Thanks for helping make managed-agents better. This project is intentionally a single-package TypeScript runtime, so the local workflow should stay boring and reliable.

## Development Workflow

1. Fork the repository.
2. Create a feature branch from `main`: `git checkout -b feat/my-feature`.
3. Install dependencies: `npm ci`.
4. Make your changes.
5. Run the release checks locally:

```bash
npm run typecheck
npm test
npm run build
```

6. Commit with a conventional commit message.
7. Push and open a pull request against `main`.

## Project Structure

```text
managed-agents/
├── src/
│   ├── api/        # Hono HTTP routes
│   ├── core/       # agents, sessions, events, memory, templates
│   ├── model/      # model provider registry
│   ├── sandbox/    # local, docker, self-hosted sandbox providers
│   ├── strategy/   # execution strategies
│   └── types/      # protocol and runtime types
├── tests/
├── examples/
└── docs/spec/
```

## Checks

The current required checks are:

- `npm run typecheck`
- `npm test`
- `npm run build`

`npm run lint` currently aliases type checking. ESLint and Prettier are not configured yet; do not add lint-only requirements to CI until the matching dependencies and config are committed.

## Code Standards

- Keep TypeScript strict-mode clean.
- Prefer existing project patterns over new abstractions.
- Keep public APIs stable unless the change is explicitly API work.
- Add focused tests when changing runtime behavior, protocol handling, sandboxing, or session lifecycle.
- Documentation may include Chinese design notes under `.kiro/` and `docs/spec/`; public README and runtime-facing docs should stay concise and accurate.

## Commit Message Format

```text
<type>(<scope>): <description>

[optional body]
[optional footer]
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

## Pull Request Requirements

- All CI checks must pass.
- PR title should follow conventional commit format.
- Keep PRs focused. Large refactors are welcome when they are motivated by a clear boundary or testability improvement.
