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
| T-33 | `set_layers` | tool-dev / map-ui-dev | cut | the flagship demo script uses no layer toggling; cut confirmed 2026-08-29 |
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
| T-50 | Activity feed data layer: record every tool call (tool, humanized summary, read/write, ok, ref ids, timestamp) into a store slice from the map-tools execute path; unit tests | tool-dev | done | PR #35 |
| T-51 | Smoked Glass chrome: brand bar, camera/Share chips, glass inspector, legend footer, Try-asking cards, breakpoint tiers incl. 769–920 sheet; WebMCP badge counts page-declared tools (11 imperative + declarative `add_note` = 12) per the handoff SHIP-GATE | map-ui-dev | done | PR #36; visual parity gate passed on independent production-build captures; bounds are the visible corridor |
| T-52 | `map-style.ts` calm ramp (z≤13 dot treatment) + selection halos per handoff | map-ui-dev | done | PR #36 |
| T-53 | Activity feed UI wired to the T-50 slice | map-ui-dev | done | PR #36; declarative add_note records agent-invoked submissions too |
| T-54 | e2e: suite green on the new chrome; share-link restore shows provenance labels on the receiving window (experience-case gate) | qa | done | PR #38 — provenance gate PASS; found the frozen-bounds defect, fixed as PR #39 (jump, don't fly, without a style) |

## Tier-2 OSM breadth — approved 2026-08-30 · gate: category-addressed city-wide breadth, deterministic and shareable

Outcome of the basemap-interop adversarial study (5 rounds; tile-reading refuted on licence/completeness/latency/actionability; the pipeline widened instead). Laws: **category filtering is the query model — no list-all tools**; category-lazy whole-city loading, NEVER bbox-lazy (store contents are a function of the requested-category set, not of camera history); tier-2 ships unpainted until a design pass; basemap stays pure display; interop = the shared `osm:<type>:<id>` namespace; concurrent painted-category ceiling = 3 (the study's round-5 memory clause, applied to browse as `BROWSE_MAX` in T-92 — recorded here 2026-08-31 after T-92's implementer correctly flagged the citation as missing).

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-60 | Tier-2 pipeline: 18 OSM categories via Overpass → `public/data/tier2/<cat>.geojson` (sorted, schema-compatible) + `tier2/index.json` manifest (category/count/bytes) | data-engineer | done | PR #44; 31,068 features, ~0.84MB gz |
| T-61 | Selection painting via feature-state (promoteId), retiring the `["in", …literal]` filter | map-ui-dev | done | PR #45; idle-to-idle flat in N, pixel-identical |
| T-62 | Category-lazy core: `loadCategory` in store; find/list/select category-required for tier-2 + disclosure of unsearched categories + counts-per-category from the manifest; select cap (refuse >500 with advice); gazetteer grows on load | tool-dev | done | PR #46; dual-tagged determinism mutation-proved |
| T-63 | Share manifest: hash wire v2 carries loaded-category list; recipient loads before resolving; prune-exemption for pending ids; loud failure | tool-dev | done | PR #48 wire v2 + #50 failure semantics (transient keeps categories declared; loaded clears failed); UI wiring PR #49 |
| T-64 | UI: disclosure strip + selected-POI materialization (membership-is-selection); tier-2 unpainted by default | map-ui-dev | done | PR #47 + share-hash wiring PR #49 |
| T-65 | e2e: determinism, lazy round-trip, share-manifest restore (money path PASS), select cap | qa | done | PR #51; 13 specs ×3 zero flake |
| T-66 | README: city-wide breadth + agent-FX sections; comparison footnotes | docs-writer | done | PR #54 |

## Agent-presence FX — approved 2026-08-30 · shipped same day

Three-round adversarial motion design (SHIP verdict; package in the design session workspace + repo `.claude` archive), then implementation.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-70 | FX tool contract: find/list origin echo (+radius_m), describe name echo, ActivityEntry.fx, RETRYABLE_4XX rider | tool-dev | done | PR #52; distances recompute from printed origins |
| T-71 | FX driver + 14 effects (reads=teal gaze, writes=materialize, human=rose; ≤2s, kill switch, reduced motion) | map-ui-dev | done | PR #53; zero residue 0/490k px reviewer-reproduced |
| T-72 | FX e2e: ON path, concurrency, kill, mount-replay guard, rm, human separation | qa | done | PR #55; MutationObserver over polling for sub-cadence windows |

## The Awakening — approved 2026-08-30 · gate: human-first product that visibly wakes into agent mode

Five-round adversarial design (SHIP verdict). Contract: `.claude/design-archive/redesign2/design2-v5.md` §8 (FINAL HANDOFF, file:line-verified) + `mockup2-v5.html` (reference, absolute path readable from worktrees). Owner signed off (2026-08-30): glow amendment; mixed-cluster=teal; caption-toast 3.2s dwell; su-less links keep teal beads with "from a shared link" hedged copy (su-on-every-link lever recorded, reversible); Chrome declarative-form exposure verified at implementation. Feed re-voicing supersedes the machine-voice rule; mono tool-name stays as the transparency spine.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-80 | Foundations: `selectionSources` store field; `su` share-wire key (ignorable, omitted-when-none) + `restoredAgentStateOf`; `src/lib/awaken/` module (mode machine, flag-first trigger, AWAKEN_MAX_MS=2000, T1–T11) | tool-dev | done | PR #60; su mirror trap closed (restore records su as user); replace:true re-attributes |
| T-81 | Bead marker system: sprites, provenance rims, cluster coalescing (~30px), browse ink budget (K=12, tier minimums), halo split | map-ui-dev | done | PR #61; found map.addLayer silently skips invalid layers — guard walks every spec |
| T-82 | Human-first IA: chrome flip, Places tray, OnTheMapCard (features+pins+drawings), liquid glass, boot-chrome no-flash probe, share su wiring | map-ui-dev | done | PR #62 (with qa's five-spec rider + the pin+card idle-note ruling) |
| T-83 | Awakening choreography (both tiers), restored surfaces, honest badge (Agent-readable until a live call) | map-ui-dev | done | PR #64; handover jumps 194/235/155px → 0.00 measured |
| T-84 | Feed re-voicing (11/11 templates tested; 'all' honestly gated) + riders | tool-dev | done | PR #63; the cafés-row decline recorded with corrected reasoning |
| T-85 | e2e: awakening contract end-to-end, bead/cluster live specs, suite hardening (browser-clock timing) | qa | done | PR #65 (+ the five-spec rider on #62, the flake fix #59); verdict: the contract holds |

## UX feedback round — 2026-08-31 · owner feedback after the Awakening shipped

Order reflects recommended sequence; all queued behind nothing — D5 assets (T-40..T-43) still own the deadline. T-90 is in flight (plan under adversarial review).

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-90 | `remove_from_map` tool: agent-side removal of drawings, annotations and selection entries (prefix-dispatched ids; user-sourced marks refused per-id in `refused`; selection-first dispatch; closes the >20 partial-deselect gap and makes the share-link overflow advice actionable) | tool-dev → map-ui-dev (roster/FX/comments) → qa | done | PR #70 → develop 0f025c4 (fact-checked: liveMark dispatch, roster entry, README rows on tree). Mark-first resolution closed the reviewer's smuggled-selection lie; per-id refusals with hoisted reasons; dissolve FX with bounded ghost memory; v3-era advice fixtures pile 8 rings with 7+1 singular coverage |
| T-91 | Merge the bottom-left legend pill ("2,063 places") into the Places dock: one bottom surface, "On the map" (six painted, swatches, counts must still sum) + "More places" (18 loadable) | map-ui-dev | done | PR #68 → develop e87565b (fact-checked: MapKey in tree, Legend gone, CSS floor present); pill `Places · 2,063`, "Already here" key + "More places" grid, LoadedCategories bottom-left |
| T-92 | Multi-category browse: Places tray multi-select paints several POI categories at once (browse-store category → set; ink budget across categories; cap concurrent painted categories; tray active-chips UI) | map-ui-dev / qa | done | PR #71 → develop 7b8313b (fact-checked: BROWSE_MAX + rose cluster icon on tree). Ordered set ≤3, eviction reported by the store itself, teal blocker resolved to rose per the provenance grammar; §9 note: at city zoom nearly every counted bead is mixed — a popover split beats a third ink |
| T-93 | Manual agent-chrome toggle, design v2 (post-review): tri-state panel store overriding rendering (awaken machine and `played` untouched); open lives in the corner spark's card, close in the agent chrome; full close returns the lane to the map and MUST rework the corridor (`inspectorLane()` → driven by chrome visibility + recompute on toggle) so `get_map_state().bounds` never lies; pulse gated on calls>0; unseen count = activitySeq delta; no persistence across reload | map-ui-dev / qa | done | PR #72 → develop ba6baed (fact-checked: panel-store on tree, design doc in docs/design, corrected get_map_state description in). All four v1 failure modes closed with measured evidence; spark ring, FX lane and the doc's first-arrival exception fixed post-review; corridor ratios exact both directions |
| T-94 | `plan_route({from, to})`: walking route via FOSSGIS `routing.openstreetmap.de` foot profile (keyless, CORS `*`, verified 2026-08-31) → Turf-simplify to ≤500 points → drawing line with label; returns distance_m, duration_s, drawing id, state; 1 req/s throttle; honest error when the service is down; attribution + "fix the map" link per FOSSGIS policy; e2e stubs the service (suite stays network-isolated); README discloses the external dependency | tool-dev / qa / docs-writer | done | PR #73 → develop bd484ab (fact-checked: route module, ROUTE_MAX_WAIT_MS, CONTRIBUTING carve-out on tree). 13th tool; first and only runtime external dependency, engineered to the FOSSGIS policy |
| T-95 | Share wire v3: delta-encoded polyline coordinates (5-decimal, Google-polyline style) for drawings, so a 500-point route fits well under MAX_SHARE_URL_BYTES; v1/v2 links must keep decoding byte-for-byte (T-63 discipline); any simplification must obey the codec honesty contract (decoded map = sender's map, or say what was lost); raise-the-cap stays a last resort, not part of this task | tool-dev / qa | done | PR #69 → develop 73d2f7a (fact-checked: codec on tree, README v3 clause in). 500-pt route 12,453→3,341 bytes; v3 only when flat cannot fit; v1/v2 byte-frozen; reviewer verdict no blockers, S2 domain guard + S1 README clause shipped with it |

## UI-parity round — 2026-08-31 · owner ruling: the UI is a first-class surface

The point of this project is human-agent collaboration, not WebMCP alone. Law for this round: **whatever the agent can read through tools, the human can see on the page** — data parity between the two surfaces, in both directions. Recommended order: T-96 lays the card's details pattern; T-97's data work runs in parallel and lands on that pattern; T-98 is independent.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-96 | POI card/inspector details section: show the fields the data already carries — `cuisine`, `brand`, `opening_hours` — plus bilingual naming (local name primary, `nameEn` secondary when present) on the tap card and the inspector's selected rows. Establishes the details-section pattern T-97 extends | map-ui-dev → qa | done | PR #75 → develop (fact-checked: feature-details seam + measured card flip on tree). Card details + bilingual names; sidebar narrowing ratified; qa e2e rides the T-97 wave |
| T-97 | Data enrichment, reflected everywhere: (1) data-engineer extends the tier-1/tier-2 pipelines to keep addr (composed one-line), phone, website, wheelchair + category-specific fields (hotel stars, parking fee/capacity, pharmacy dispensing, worship religion, hospital emergency), re-runs them, measures the gz impact (Overpass sample 2026-08-31: addr 55-58%, phone 30%, wheelchair 26%); (2) tool-dev adds read-only `get_place_details(id)` — full fields for one feature, lists stay lean — plus roster/FX/e2e parity ripples; (3) map-ui-dev lands every new field in T-96's details section (opening_hours display treatment is the implementer's design call — raw OSM syntax needs taming); (4) qa e2e | data-engineer ∥ tool-dev → map-ui-dev → qa | done | PR #77 → develop 1636e64 (fact-checked: 14th tool, 31,069 enriched features, parity-law spec on tree). Address/phone/website/wheelchair + category facts on every surface; T-99's five poll sites rooted out; mockMinimalBasemap unlocks canvas-click e2e under isolation |
| T-98 | Search, both surfaces in one task: tool-dev gives `list_features_in_view` the same `query` parameter `find_features` has (view-scoped keyword search for agents — the two tools exist but cannot combine today); map-ui-dev adds the human search box (searches loaded features across name/nameEn/brand/cuisine, view-first ranking, result tap selects and flies; placement is the implementer's call within the human-first idle chrome); qa e2e for both | tool-dev ∥ map-ui-dev → qa | done | both halves shipped (PR #74 tool, PR #76 UI — fact-checked): agents search the view by name, humans search everything loaded with a box that never wakes the agent; search e2e rides the round's qa wrap-up |
| T-99 | qa hardening: the 2500ms `data-awaken` poll family | qa | done | all five poll sites fixed on the T-97 branch (waitForAwake in helpers, 280 repeat-runs green); ONE residual site ticketed below (awakening.spec.ts:672, a different shape — Node-side reads of the 1.8s disabled window) |

## Follow-ups from the two 2026-08-31 rounds (ticketed, unscheduled)

- **F-1 (qa)** `awakening.spec.ts:672` — the flake family's last site: `stateAfterWaking` returns ~600ms into the story, then two Node-side locator assertions race the remaining ~1200ms of the `disabled` window; fold the reads into the same in-page tick. Pre-existing; deterministic-failure mode once the story lands.
- **F-2 (map-ui-dev)** idle-chrome `.hint`/`.attribution` ~13px overlap at 1240 AND 1440 (measured with the search box display:none — pre-existing); fix together with adding "search" to the landing hint (the hint grows into the same overlap; choreography only writes opacity to it, so copy is safe).
- **F-3 (data-engineer)** address generation guard: 152 addresses are a bare city name, 243 carry no street/號 — require a street token before emitting; also 19 `addr:full` values carry upstream city/district duplication verbatim (documented choice, revisit if judges notice).
- **F-4 (docs-writer)** README narrative debt: the search box and the enrichment story are absent (tool contract itself is current); `TryAsking` has no `get_place_details` prompt card; pre-Awakening wording flagged since T-41 still stands.
- **F-5 (orchestrator)** Overpass endpoint rot: overpass-api.de and kumi.systems both failed all attempts this export; only the .fr mirror answered. Reorder ENDPOINTS or note the operational reality before the next data re-run.
- **F-6 (map-ui-dev, design question)** `SelectedRow.details` is computed for sidebar rows and never rendered (T-96 ratified narrowing) — revisit only if the owner wants details in the list too.

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
- 2026-08-29 · reviewer → qa · e2e/set-map-view.spec.ts:11-24 comment is stale after PR #39: under network isolation the re-entrant moveend now comes from jumpTo, not flyTo's stop(); the mid-flight-clobber race is only exercised with E2E_LIVE_BASEMAP=1 — update the comment, consider a live-basemap variant.
- 2026-08-29 · reviewer → docs-writer (T-41) · docs/comparison.md:57 "camera animates, state settles at moveend" is over-cautious since PR #39 (no-style path jumps synchronously); soften when T-41 touches the file.
- 2026-08-29 · qa/map-ui-dev → orchestrator · "Hide" collapses only the inspector body; the glass lane still covers the map, so bounds keep excluding it (correct). If Hide should return the lane to the map, that is a layout decision — padding and bounds would follow for free.
- 2026-08-30 · orchestrator → all · Tier-2 approved by the user (time explicitly not a constraint; agent-parallel build). Integration on develop only; main stays demo-stable until the whole package is green. Category taxonomy and interface contracts are fixed in the dispatches.
- 2026-08-30 · qa → orchestrator (decision logged) · the toMap re-entrancy guard is only exercised by the opt-in live-basemap spec (isolation forces jumpTo); accepted live-only exercise for now.
- 2026-08-30 · docs-writer → orchestrator · README roadmap table still frames a 5-day build with no tier-2/redesign/FX rows — a scope decision for T-41's final pass.
- 2026-08-31 · qa → map-ui-dev · MapCanvas.tsx:633 comment says a bead tap deselects; it opens the card (correct behavior, stale words) — cosmetic, ride any next components pass.
- 2026-08-31 · reviewers → docs-writer · README lines 6/56/94/95 still describe the pre-Awakening chrome (sidebar as landing surface, feed as landing chrome) — the final docs pass (T-41) owns the rewrite.
- 2026-08-31 · suite lesson (recorded) · timing checks against animations must anchor to the browser's clock (MutationObserver + performance.now in one evaluate); Node-side polls across IPC lose races on shared runners — three instances fixed in fx.spec.ts.
- 2026-08-31 · orchestrator → all · The 2026-08-28 line "delete is UI-only" is superseded by T-90: `remove_from_map` gives agents removal of agent-sourced drawings/annotations and any selection entry; user-sourced marks stay human-only (refused per-id with the reason).
- 2026-08-31 · user → orchestrator · T-94/T-95 take priority over the D5 submission assets; do not schedule D5 work until the user says so.
- 2026-08-31 · map-ui-dev → orchestrator (T-91) · prose-only stale references to the retired legend remain outside UI ownership: `src/lib/awaken/timeline.ts:109-114`, `src/lib/awaken/timeline.test.ts:151` (comments), and `docs/design/ui-redesign-handoff.md` (docs-writer) — ride the next pass that touches each file.
