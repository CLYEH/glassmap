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


---

Archived 2026-09-02 by the orchestrator, when the T-106…T-110 rounds pushed the board past ~150 lines again. Every row below is `done`.

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

## T-100 — search index · approved 2026-08-31 evening · gate: "starbucks" finds 152 stores on a fresh page

Owner-reported defect: the search box only covers loaded features, so brand searches on a landing page find nothing and the empty-state hint expects the human to know which category to load. Fix: a citywide name index derived LOCALLY from the existing tier-2 files (no Overpass — F-5 avoided), fetched once on first search; index hits from unloaded categories render with a loads-on-pick affordance (the pick IS the deliberate load request — category-lazy law intact); find_features' disclosure names index hits in unloaded categories so the agent's next call is obvious (no auto-load).

Index contract v2 (owner widened the goal 2026-08-31 evening: "almost ANY input finds something", not just brands): `public/data/tier2/search-index.json` = `{ "generated": "<date>", "rows": [[id, name, nameEn|"", brand|"", cuisine|"", address|"", categories-comma-joined, lng5, lat5], ...] }`, tier-2 features only, sorted by id — address matching covers street/neighbourhood inputs (42.7%), cuisine covers "ramen"/"coffee"-style inputs. The UI additionally matches a curated bilingual CATEGORY vocabulary (18 categories × en/zh labels + common aliases: 咖啡→cafe, 藥局→pharmacy, 便利商店→convenience…) rendered as browse-this-kind rows, so category-word inputs always land. Fuzzy/typo matching is explicitly OUT of scope this round (substring over 33k names + addresses + the vocabulary is the "almost any input" bar; typo tolerance is its own project). Acceptance gate: a qa battery of arbitrary inputs (brands zh/en, cuisine words zh/en, street names, category words zh/en, bundled-data names) each produce ≥1 row on a FRESH page. Store contract: map-store + MapToolStore gain `getSearchIndex()`, `loadSearchIndex()` (one fetch via the tier2FetchJson injection path, cached, honest failure state).

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-100 | Search index end to end: (1) pipeline emits the index (local derivation, size measured); (2) store loader + find_features disclosure extension; (3) search box consults index, loads-on-pick, then selects and flies; (4) qa: the starbucks path end to end | data-engineer → tool-dev → map-ui-dev → qa | done | PR #81 → develop c372da2 (fact-checked: index on tree, SearchBox on the plain loader). 12-input acceptance battery green; dual-track picks; unloaded_matches for agents; the restore-impersonation fix probed end to end |
| T-101 | Inspector rows become actionable (owner request): a Selected row zooms to its feature on click and carries a per-row deselect; Shapes/Notes rows zoom to their geometry on click (fitBounds for areas/lines, centre for pins), keeping their existing ✕; keyboard reachable; writers/provenance identical to the tap card's (human gestures, `"user"` attribution, human FX on removal) | map-ui-dev → qa | doing(qa) | implementation 433a2e1 (frame-model: corridor-derived zoomToFit, no DOM read; sibling-button hygiene; probes: district fit 80.0% of the binding axis, deselect preserves sources, activity untouched); RULING upheld: points never zoom out, area fits may widen — a district click that changes nothing is the failure the row exists to remove; done — PR #80 → develop 0cfee07 (fact-checked: frame-model + must-travel spec on tree). Widening ruling UPHELD as one rule branching on extent; review prescriptions landed (travel assertion, the third unsafe approximation named); handoffs: activity doc one-liner (tool-dev next baton), README collaboration bullet (F-4) |

## T-102 — reverse-parity gaps · approved 2026-08-31 night · gate: the agent can do what the human can

Owner: "A/B 都修". Gap A: the human box matches name/nameEn/brand/cuisine/address; the agent's query matches names only — widen the shared predicate on BOTH the loaded search and `unloaded_matches` together, which dissolves T-100's names-only asymmetry by making the promise and its fulfilment match again (the mutation tests that pinned names-only flip to pin all-five-on-both-sides). Gap B: `set_map_view` gains `fit` (a drawing or feature id) framed by the SAME math as T-101's rows — the pure frame/zoomToFit core relocates from src/components into src/lib (legal import direction) so agent and human literally share one function; point targets keep PLACE_ZOOM semantics, area targets may widen (the recorded one-rule-branching-on-extent).

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-102 | Query parity (five-field matching, both sides of the disclosure) + camera fit-to-target for agents (frame math relocated to src/lib, components re-import) | tool-dev (waivered import flips) → map-ui-dev → qa → review | done | PR #84 → develop (fact-checked: src/lib/geo on tree, the zoom floor in). Five-field parity on every surface with one predicate; fit-vs-row byte-equal by e2e; the last silent zoom-out removed by ruling; ≥ floor proven un-overstatable |

## T-103 — the load-window place-name race · approved 2026-09-01 · gate: a name is never answered out of a half-loaded gazetteer

Found by adversarial review of T-41's fifth ask card. `resolveQueryInput` loads a named category **before** it resolves `near` (deliberate — it lets `{near:"Fika Fika Cafe", categories:["cafe"]}` find its own origin), while the six bundled datasets arrive asynchronously. In that window a place name matched the just-fetched category alone, and `post_office.geojson` holds exactly one substring match for "daan": `osm:way:206062024`, Taipei Da-an Post Office, 524 m from the real station. One match is not a tie, so `resolvePlaceOne` returned `found` — a confident wrong answer with no error and no candidates. Every spelling of the station collapsed onto it. Owner approved fixing the tool layer rather than rewording the card.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-103 | `baseDataLoaded` flag + guard on the place-name form of `resolveNear` and `set_map_view.place` (ids and coordinates deliberately ungated); retryable refusal naming an accurate remedy; the refusal documented in `POINT_STRING_FORM` so the model reads it before calling; gated `base_data_loading` on state and on the four read-only answers that return none; `planCategories` splits the claim from the filter so `searched_categories` stops vouching for files that are not in the store | tool-dev → review | done | PR #88 → develop `da6c27b`. Regression test proven to fail without the fix (12/26 red on reverted sources); the coverage test proven to bite (removing the `annotate` row goes red). Blast radius is the load window only — output is byte-identical on any settled page |

## T-104 — the awakening cancelled the flight it interrupted · found 2026-09-02 while recording the README comparison · gate: an agent's first `set_map_view` lands where the tool said

Reproduced on production: `set_map_view({ place: "Daan Station" })` as the very first tool call returned a z15 camera, and the map settled back at z12. The first live call wakes the inspector lane, which calls `map.setPadding` — in maplibre-gl 6.6.0 that is `jumpTo({ padding })`, which opens with `stop()` and fires two synchronous `moveend`s carrying the pre-flight camera; the store adopted them and the flight was gone. Every later call (page already awake) was fine, which is why no e2e spec ever saw it: the default network-isolated page never loads a style, so `flyTo` degraded to a synchronous jump there.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-104 | `flying` flag in `MapCanvas`: a corridor change (chrome wake, chrome flip, window resize) during a flight of ours re-issues the flight to the same target inside the `toMap` guard; a human gesture clears the flag so a drag mid-flight is never overridden; a resize mid-flight calls `map.resize()` first so the re-fly aims at the new canvas and republishes `bounds` | map-ui-dev → review → qa → review | done | Two review rounds. Review 1 found the resize path landing ~300 m off and `bounds` stale for the flight's duration; both fixed and probed before/after on a live basemap (landing error 302.7 m → 0.0 m). `e2e/awakening-flight.spec.ts`: 4 tests on the mock basemap, three proven red on the pre-fix `MapCanvas`, the fourth guards human authority |
