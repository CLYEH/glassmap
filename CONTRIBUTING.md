# Contributing to GlassMap

This file is the working protocol for everyone who commits to this repo — humans and AI agents alike. It is short on purpose; if something here is wrong, change it in a PR rather than working around it.

## Branches

| Branch | Purpose | Deploys to |
|---|---|---|
| `main` | Production. What judges and users see. | Vercel production (auto on push) |
| `develop` | Integration branch. All feature work lands here first. | Vercel preview URL (auto on push) |
| `feat/<scope>-<slug>` | One task, one branch, short-lived. Cut from `develop`. | Vercel preview (per branch) |
| `fix/<scope>-<slug>` | Bug fix. Cut from `develop`. | — |
| `hotfix/<slug>` | Urgent production fix. Cut from `main`, merged to `main` **and** `develop`. | — |
| `test/<scope>-<slug>` | Test-only work (e2e suites, test infrastructure). Cut from `develop`. | — |
| `docs/<slug>` | Documentation only. | — |

`<scope>` is one of `tools`, `ui`, `data`, `qa`, `docs`, `harness`. Tasks live in `docs/TASKS.md` (orchestrator-owned); put the task id in the slug: `feat/tools-t11-find-features`.

Flow: `feat/*` → PR → `develop` (squash merge) → PR → `main` (merge commit). Nobody pushes directly to `main` or `develop`.

## Worktrees (parallel work)

Each agent works in its own worktree so branches never share a working directory:

```bash
git worktree add ../glassmap-wt/<branch> -b <branch> develop
cd ../glassmap-wt/<branch>
pnpm install            # required: pnpm's Windows junctions are absolute paths
E2E_PORT=31xx pnpm test:e2e   # pick a free port; the default 3100 is taken by the main checkout
```

Remove it when the PR is merged: `git worktree remove ../glassmap-wt/<branch>`.

Note: gitignored files (`CLAUDE.local.md`, `.claude/`) do not exist in a worktree. Everything an agent needs must be in committed files — this one and `CLAUDE.md`.

## Ownership

Parallel work is safe only because each area has one owner. Edit outside your area → stop and hand off (see below).

| Area | Owner | Paths |
|---|---|---|
| Tool layer | `tool-dev` | `src/lib/map-tools/**`, `src/lib/store/**`, their `*.test.ts` |
| UI | `map-ui-dev` | `src/components/**`, `src/app/**` |
| Data | `data-engineer` | `public/data/**`, `scripts/**`, `src/lib/data/**` |
| Tests | `qa` | `e2e/**`, `playwright.config.ts`, `vitest.config.mts`, new cross-area `*.test.ts` (a unit test co-locates with its subject and belongs to that area's owner) |
| Docs | `docs-writer` | `README.md`, `docs/**` |
| Everything else | orchestrator | `package.json`, lockfile, `.github/**`, `src/lib/webmcp/**`, `scripts/ship-pr.sh`, `CLAUDE.md`, this file |

Two hard rules that follow from this:

- **Only the orchestrator adds or upgrades dependencies.** Lockfile conflicts are the most expensive merge conflicts; agents request packages in their report.
- **`public/data/*.geojson` is never edited in parallel.** Data changes go through `data-engineer` one PR at a time.

## Handoffs

Agents do not talk to each other. A handoff is a message to the orchestrator in the agent's final report (the orchestrator records it in the handoff log at the bottom of `docs/TASKS.md`), containing:

1. What you need and from which owner (e.g. "`map-ui-dev`: store needs `drawings: Drawing[]` with `{id, type, geometry}`").
2. The interface you propose, as TypeScript, so the other side can implement against it before you are done.
3. What you did in the meantime (stubbed, skipped, blocked).

Shared interfaces live in committed type files (`src/lib/store/map-store.ts`, `src/lib/data/schema.ts`); the orchestrator changes those first, then both sides implement.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), English only:

```
<type>(<scope>): <imperative summary, ≤72 chars>

<why this change, not what — the diff shows what>

Task: T-11                 # id from docs/TASKS.md
Co-Authored-By: …          # keep the trailers your tooling adds
```

`type` ∈ `feat | fix | test | docs | refactor | chore | data`. `scope` as above. One logical change per commit; agents commit on their own feature branch as often as they like — the PR is squashed anyway.

## Pull requests

Open with `gh pr create --base develop`. The template asks for three things and all three are mandatory:

- **What** — one paragraph.
- **Why** — the user-visible reason, tied to the decision record when relevant.
- **How verified** — paste the tail of `pnpm check` and `pnpm test:e2e`; UI changes include a screenshot or the exact `data-testid` values that changed.

Before requesting merge:

1. `pnpm check` and `pnpm build` are green locally.
2. The `reviewer` agent has run on the diff and every high-severity finding is fixed or explicitly declined in the PR.
3. CI is green (`.github/workflows/ci.yml` runs the same commands plus Playwright).

`develop → main` PRs are releases: additionally smoke-test the `develop` preview URL in Chrome with the WebMCP flag, and tag after merge (`d1`, `d2`, …; `v1.0-submission` for the final one).

## Definition of done

A task is done only when **all** of these hold. Anything missing must be stated in the report — narrowing scope is the orchestrator's call, not the agent's.

- Tests exist for the behaviour and encode *why* it matters; `pnpm check` green, no skipped tests.
- Relevant e2e spec green.
- No `alert` / `confirm` / `prompt`; no external API calls or keys; nothing from the banned list (Shopify, Google Maps, geocoders, QR, GPS).
- Docs updated if the change is visible to judges or users.
- Everything in the repo is English. The only permitted CJK is inside string literals that are genuine data — OSM tag values in queries, place-name test inputs. Comments, prose and commit messages are always English.
- A PR whose suite contains `test.fail()`-marked known-defect tests must say so explicitly in "How verified" — green CI must never hide a known defect.

## Ports

| What | Port |
|---|---|
| `pnpm dev` | 3000 |
| Playwright web server | `E2E_PORT`, default 3100 |

## Environment and secrets

There are none. The app has no backend, no database and no API keys; Vercel needs no environment variables. Any credential appearing in a diff is a review blocker. `.env*` is gitignored as a safety net only.

## Freeze

After the demo video is recorded (planned D5, 2026-09-01) `main` is frozen: hotfixes only, each one re-verified on the production URL. Judges evaluate the deployed `main` after the deadline (2026-09-03 13:00 PDT).
