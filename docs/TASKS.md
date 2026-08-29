# Task board

Single source of truth for what is being worked on. **Only the orchestrator edits this file**; agents read it and reference task ids (`T-xx`) in branch names and PRs. Status: `todo` · `doing(<agent>)` · `review` · `done` · `cut`.

Size rule: keep this file under ~150 lines. When a day is fully `done`/`cut`, collapse it to one line and move the detail to `docs/TASKS-archive.md`; delete handoff entries once resolved.

Deadline: 2026-09-03 13:00 PDT. Must-have tools: `get_map_state`, `list_features_in_view`, `find_features`, `describe_surroundings`, `set_map_view`, `draw_shape`, `select_features`, `annotate`. Everything else is cut first when time runs out.

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
| T-33 | `set_layers` | tool-dev / map-ui-dev | todo | |
| T-34 | Screenshot-vs-WebMCP comparison (3 tasks, one run each) | orchestrator + qa | done | `docs/comparison.md`; headline: 4 calls/4.5 KB vs 16 actions+11 screenshots, control failed task B (1/11 names) |

## D5 — 2026-09-01 · submission assets

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-40 | Demo video < 3 min, English narration, tool call visible in first 20 s | user + docs-writer (script) | todo | |
| T-41 | README final: flag steps, 3 example prompts, comparison table, data licence | docs-writer | todo | |
| T-42 | Devpost text incl. "collaborative capabilities" | docs-writer | todo | |
| T-43 | Freeze `main`, tag `v1.0-submission` | orchestrator | todo | |

## D6 — 2026-09-02 · buffer; submit by evening of 2026-09-03 Taiwan time

## UI redesign — "Smoked Glass" · approved 2026-08-29 · gate: production matches the shipped mockup

Design handoff: `docs/design/ui-redesign-handoff.md` (tokens, component inventory, ship-gates, honesty caveats). Verdict: SHIP after a five-round adversarial design review; mockup + evidence live in the design session workspace outside the repo.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-50 | Activity feed data layer: record every tool call (tool, humanized summary, read/write, ok, ref ids, timestamp) into a store slice from the map-tools execute path; unit tests | tool-dev | doing(tool-dev) | interface contract fixed in dispatch; newest last, cap 50; real call order — no storytelling reorder |
| T-51 | Smoked Glass chrome: brand bar, camera/Share chips, glass inspector, legend footer, Try-asking cards, breakpoint tiers incl. 769–920 sheet; WebMCP badge counts page-declared tools (11 imperative + declarative `add_note` = 12) per the handoff SHIP-GATE | map-ui-dev | doing(map-ui-dev) | keep every data-testid and the real `<form toolname="add_note">`; attribution links stay; no modals |
| T-52 | `map-style.ts` calm ramp (z≤13 dot treatment) + selection halos per handoff | map-ui-dev | doing(map-ui-dev) | same branch as T-51 |
| T-53 | Activity feed UI wired to the T-50 slice | map-ui-dev | doing(map-ui-dev) | build last; merge develop after T-50 lands — do not touch the store yourself |
| T-54 | e2e: suite green on the new chrome; share-link restore shows provenance labels on the receiving window (experience-case gate) | qa | todo | dispatch after T-51 merges |

## Handoff log

Append-only. `date · from → to · what`.

- 2026-08-28 · orchestrator → all · Harness ready; read `CONTRIBUTING.md` and `docs/webmcp-reference.md` before starting.
- 2026-08-28 · reviewer → tool-dev · District polygons are simplified independently, so shared borders have seams up to ~150 m; a point-in-polygon "current district" lookup returns none for ~1/700 map centres near borders. When implementing district lookup: fall back to nearest district by boundary distance; if two match, take the first.
- 2026-08-28 · map-ui-dev → qa · Add e2e: two `set_map_view` calls back-to-back without awaiting the first flight; assert the second call's return matches its request (re-entrancy guard), and `get_map_state().bounds` is non-null immediately after `window.__glassmap` appears.
- 2026-08-28 · orchestrator → all · Selection ids are `feature.properties.id`; GeoJSON features have no top-level `Feature.id` (UI filters on `["get","id"]`).
- 2026-08-28 · tool-dev → map-ui-dev · Hand-drawn circles must be polygonised Polygon geometry (Point+radius is invisible to `within`); UI must display `drawing:<n>` / `annotation:<n>` ids so a human can name them; delete is UI-only.
- 2026-08-28 · reviewer → qa (T-23) · The no-WebGL bounds fallback has no failing-capable test: stub `getContext("webgl2")`→null, assert `map-status="unavailable"` and non-null bounds. Headless CI HAS WebGL (SwiftShader) — do not assume otherwise.
- 2026-08-28 · orchestrator → tool-dev · Add one sentence to set_map_view/list_features_in_view descriptions: the camera animates, bounds settle at moveend — call view-dependent tools after movement settles (found in T-34 measurement).
- 2026-08-28 · qa → tool-dev · get_share_link's over-budget error returns bare number counts (drawings/selection) while the success path's state.drawings is {count, items} — align the shapes in the next tool batch (LLM friction, not a defect).
- 2026-08-28 · data-engineer → all · T-24 verified: coordinate 121.4933,25.0143 is inside Wanhua (a real neighbourhood), NOT Banqiao Station (real: 121.4618,25.0132, outside all polygons at every tolerance). Seam gaps (~150 m) are source-data properties; tolerance cannot close them — the describe_surroundings 300 m fallback is the correct mechanism.
- 2026-08-29 · orchestrator → tool-dev/map-ui-dev · UI redesign approved by the user; activity-feed interface contract is in the dispatch; durable design handoff committed at docs/design/ui-redesign-handoff.md.
