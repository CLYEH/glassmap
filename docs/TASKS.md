# Task board

Single source of truth for what is being worked on. **Only the orchestrator edits this file**; agents read it and reference task ids (`T-xx`) in branch names and PRs. Status: `todo` · `doing(<agent>)` · `review` · `done` · `cut`.

Size rule: keep this file under ~150 lines. When a day is fully `done`/`cut`, collapse it to one line and move the detail to `docs/TASKS-archive.md`; delete handoff entries once resolved.

Deadline: 2026-09-03 13:00 PDT. Must-have tools: `get_map_state`, `list_features_in_view`, `find_features`, `describe_surroundings`, `set_map_view`, `draw_shape`, `select_features`, `annotate`. Everything else is cut first when time runs out.

## D1 — 2026-08-28 · gate: a real WebMCP client calls a tool on the deployed URL

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-01 | Harness, scaffold, shim, `get_map_state` + `set_map_view` on in-memory state, CI, CONTRIBUTING | orchestrator | done | |
| T-02 | Push scaffold to GitHub, connect Vercel (prod = `main`, preview = `develop`) | orchestrator + user | done | prod: https://glassmap.clyeh.xyz |
| T-03 | MapLibre + OpenFreeMap map component; store ⇄ map sync; `set_map_view` flies the real map | map-ui-dev | todo | keep `data-testid`s from placeholder page |
| T-04 | Verify `queryRenderedFeatures` reads POI layers from the liberty style | map-ui-dev | todo | result decides whether basemap POIs are in scope |
| T-05 | D1 gate: ChatGPT desktop built-in browser lists and calls `get_map_state` | user + orchestrator | todo | fallback: Chrome flag + Inspector; rewrite demo script |

## D2 — 2026-08-29 · gate: demo steps 1–4 run

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-10 | GeoJSON: MRT stations, districts, parks, schools, supermarkets, sample listings; gazetteer | data-engineer | todo | schema in `src/lib/data/schema.ts` first |
| T-11 | `list_features_in_view`, `find_features` (query / categories / near / radius_m / within) | tool-dev | todo | depends on T-10 schema |
| T-12 | `select_features` + highlight on map + sidebar list | tool-dev (tool) / map-ui-dev (UI) | todo | store gets `selection: string[]` |
| T-13 | E2E for T-11/T-12 through `document.modelContext` | qa | todo | |

## D3 — 2026-08-30 · gate: demo steps 6–8 run

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-20 | `draw_shape` (circle/polygon/line) + hand-drawing UI; drawings visible to `get_map_state` / `find_features({within})` | tool-dev / map-ui-dev | todo | the "human draws, agent reads" moment |
| T-21 | `annotate` (imperative) + declarative `<form toolname>` version | tool-dev / map-ui-dev | todo | shows both APIs |
| T-22 | `describe_surroundings` (direction-grouped, from geometry) | tool-dev | todo | Persona B |
| T-23 | E2E for D3 | qa | todo | |

## D4 — 2026-08-31 · nice-to-have, in order

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-30 | `compare_areas` | tool-dev | todo | |
| T-31 | `get_share_link` (state in URL hash) | tool-dev / map-ui-dev | todo | |
| T-32 | `measure` | tool-dev | todo | |
| T-33 | `set_layers` | tool-dev / map-ui-dev | todo | |
| T-34 | Screenshot-vs-WebMCP comparison (3 tasks, one run each) | orchestrator + qa | todo | numbers go to README |

## D5 — 2026-09-01 · submission assets

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-40 | Demo video < 3 min, English narration, tool call visible in first 20 s | user + docs-writer (script) | todo | |
| T-41 | README final: flag steps, 3 example prompts, comparison table, data licence | docs-writer | todo | |
| T-42 | Devpost text incl. "collaborative capabilities" | docs-writer | todo | |
| T-43 | Freeze `main`, tag `v1.0-submission` | orchestrator | todo | |

## D6 — 2026-09-02 · buffer; submit by evening of 2026-09-03 Taiwan time

## Handoff log

Append-only. `date · from → to · what`.

- 2026-08-28 · orchestrator → all · Harness ready; read `CONTRIBUTING.md` and `docs/webmcp-reference.md` before starting.
