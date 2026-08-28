@AGENTS.md

# GlassMap

An agent-native web map: WebMCP tools expose map state, features and actions so an AI agent never needs a screenshot. Everything in this repo is English.

- **Read `CONTRIBUTING.md` before changing anything** — branches, worktrees, ownership, commit and PR format, definition of done.
- **Read `README.md`** for the tool contract and architecture (no backend, no database, no API keys, no `alert`/`confirm`/`prompt`).
- **WebMCP facts come from `docs/webmcp-reference.md`** (verified sources + the API shape we code against). Do not research WebMCP independently; report anything that looks outdated.
- Current work and task ids are in `docs/TASKS.md` (orchestrator-owned; agents read only).
- Verify with `pnpm check` (typecheck + lint + unit tests) and `pnpm test:e2e`; do not report work as done while either fails.
