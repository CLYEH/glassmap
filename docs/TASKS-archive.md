# Task board archive

Days collapsed out of `docs/TASKS.md` once fully `done`/`cut`, per that file's size rule. Nothing here is live work; it is kept so a task id in a branch name or PR still resolves to its detail.

Archived 2026-09-01 by the orchestrator, when D5 work pushed the board past ~150 lines.

## D1 — 2026-08-28 · gate: a real WebMCP client calls a tool on the deployed URL

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-01 | Harness, scaffold, shim, `get_map_state` + `set_map_view` on in-memory state, CI, CONTRIBUTING | orchestrator | done | |
| T-02 | Push scaffold to GitHub, connect Vercel (prod = `main`, preview = `develop`) | orchestrator + user | done | prod: https://glassmap.clyeh.xyz |
| T-03 | MapLibre + OpenFreeMap map component; store ⇄ map sync; `set_map_view` flies the real map | map-ui-dev | done | this PR |
| T-04 | Verify `queryRenderedFeatures` reads POI layers from the liberty style | map-ui-dev | done | verdict: basemap POIs OUT of tool scope — `queryRenderedFeatures` returns only label-collision survivors (~36 of ~9,400 at z15); tools read our GeoJSON only |
| T-05 | D1 gate: ChatGPT desktop built-in browser lists and calls `get_map_state` | user + orchestrator | done | passed 2026-08-28 evening: ChatGPT desktop lists all 11 tools on production; Chrome-flag fallback not needed |

## D2 — 2026-08-29 · gate: demo steps 1–4 run

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-10 | GeoJSON: MRT stations, districts, parks, schools, supermarkets, sample listings | data-engineer | done | PR #4; 2,063 features, 586 KB; gazetteer moved to tool layer |
| T-11 | `list_features_in_view`, `find_features` (query / categories / near / radius_m), gazetteer, `set_map_view` place/feature_id | tool-dev | done | PR #5; `within` deferred to D3 |
| T-12 | `select_features` + highlight on map + sidebar list | tool-dev (tool) / map-ui-dev (UI) | done | |
| T-13 | E2E for T-11/T-12 through `document.modelContext` | qa | done | landed across the merged suite; network-isolated in PR #30, share-hash convergence in PR #33 |

## D3 — 2026-08-30 · gate: demo steps 6–8 run

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-20 | `draw_shape` (circle/polygon/line) + hand-drawing UI; drawings visible to `get_map_state` / `find_features({within})` | tool-dev / map-ui-dev | done | |
| T-21 | `annotate` (imperative) + declarative `<form toolname>` version | tool-dev / map-ui-dev | done | |
| T-22 | `describe_surroundings` (direction-grouped, from geometry; district with ≤300 m seam fallback) | tool-dev | done | |
| T-23 | E2E for D3 (drawing round-trip, declarative form, no-WebGL bounds wiring) | qa | done | folded into the merged suite; test.fail debt resolved in PR #16 |
| T-24 | Sharpen `districts.geojson` (tolerance 0.00003) + boundary sanity tests | data-engineer | done | premise partially refuted: the reported point was a Wanhua neighbourhood, not Banqiao Stn; real Banqiao was never inside any polygon. Seam gaps are OSM source properties (adjacent relations share no nodes) — handled by the 300 m fallback, not by tolerance |

## D4 — 2026-08-31 · nice-to-have, in order

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-30 | `compare_areas` | tool-dev | done | PR #16 |
| T-31 | `get_share_link` (state in URL hash) | tool-dev / map-ui-dev | done | codec + tool + UI wiring + 7 e2e; address bar mirrors the map |
| T-32 | `measure` | tool-dev | done | PR #16 |
| T-33 | `set_layers` | tool-dev / map-ui-dev | cut | the flagship demo script uses no layer toggling; cut confirmed 2026-08-29 |
| T-34 | Screenshot-vs-WebMCP comparison (3 tasks, one run each) | orchestrator + qa | done | `docs/comparison.md`; headline: 4 calls/4.5 KB vs 16 actions+11 screenshots, control failed task B (1/11 names) |

