# Agent Rules

Project-specific rules for AI agents working in this repository.

- Use `pnpm` for dependency management and scripts.
- Treat the repository root as one pnpm workspace.
- Put reusable cross-app code in `shared`.
- Keep Cloudflare credentials out of source code; use GitHub Secrets or Cloudflare configuration.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before handing off changes.
- Use `pnpm e2e` when frontend workflow behavior changes.
- Follow repo-specific rules in [.rules/](./frontend-platform.md) and the per-domain rule files (e.g. [migrations](./migrations.md), backend-patterns).
