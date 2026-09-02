# Task board

Single source of truth for what is being worked on. **Only the orchestrator edits this file**; agents read it and reference task ids (`T-xx`) in branch names and PRs. Status: `todo` · `doing(<agent>)` · `review` · `done` · `cut`.

Size rule: keep this file under ~150 lines. When a day is fully `done`/`cut`, collapse it to one line and move the detail to `docs/TASKS-archive.md`; delete handoff entries once resolved.

Deadline: 2026-09-03 13:00 PDT. Must-have tools: `get_map_state`, `list_features_in_view`, `find_features`, `describe_surroundings`, `set_map_view`, `draw_shape`, `select_features`, `annotate`. Everything else is cut first when time runs out.

## D1–D4 — 2026-08-28 … 2026-08-31 · all `done` or `cut`; detail in [`docs/TASKS-archive.md`](./TASKS-archive.md)

- **D1** harness, scaffold, MapLibre + OpenFreeMap on Vercel, `get_map_state` / `set_map_view`, CI. Gate passed 2026-08-28: ChatGPT desktop listed the tools on production and called one (T-01…T-05).
- **D2** the six bundled GeoJSON datasets, `list_features_in_view`, `find_features`, `select_features` + sidebar, gazetteer, e2e (T-10…T-13).
- **D3** `draw_shape` (agent- and hand-drawn), `annotate` imperative + declarative, `describe_surroundings`, district sharpening (T-20…T-24).
- **D4** `compare_areas`, `measure`, `get_share_link`, the screenshot-vs-WebMCP comparison (`docs/comparison.md`). `set_layers` **cut** 2026-08-29 — the demo script uses no layer toggling (T-30…T-34).

## D5 — 2026-09-01 · submission assets

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-40 | Demo video < 3 min, English narration, tool call visible in first 20 s | user + docs-writer (script) | todo | |
| T-41 | README final: flag steps, 3 example prompts, comparison table, data licence | docs-writer | done | PR #89 (5th ask card) + this PR. Owner widened scope 2026-09-01: also closed F-4's README debt, deleted the Roadmap section, and fixed a tool-count lie (README said the badge counts 12; the roster is 14 + `add_note` = 15). Two review rounds; four false claims about the *human* surfaces were caught and corrected |
| T-42 | Devpost text incl. "collaborative capabilities" | docs-writer | todo | |
| T-43 | Freeze `main`, tag `v1.0-submission` | orchestrator | todo | |

## D6 — 2026-09-02 · buffer; submit by evening of 2026-09-03 Taiwan time

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-105 | README shows the map before it explains it: 251 → 124 lines, describes only shipped behaviour; hero and landing images; two GIFs of the same ask card run by a screenshot agent and by a WebMCP agent; `docs/details.md` keeps the cut prose | docs-writer → review → docs-writer → review | done | Owner asked 2026-09-02 for: no unshipped work in the README, a 2–3 scenario comparison recording, images, and a condensed pitch judged adversarially. Two scenarios recorded (Playwright headless Chromium, scripted replays, WebMCP arm on `?shim=1`; the README says all of this); a third, human–agent collaboration, was not recorded — the "One map, two hands" section carries it in text. Recording the first arm surfaced T-104. Two review rounds: nine false or unsupported claims corrected before merge |

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

## T-106 — a human pins a note where they click · owner request 2026-09-02 · gate: a person's note lands under their cursor, an agent's exactly where it landed before

Owner: the Note pill is unfriendly to a person — the form pins only at the map centre, so placing a note means panning the whole map until the spot is under the crosshair. Human side only: the declarative `add_note` tool (its `toolname`, `tooldescription`, `toolparamdescription`, and an agent-invoked submit landing at `view.center`) does not change, and neither does the imperative `annotate`.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-106 | While the Note popover is open and draw mode is off, a map click places a provisional rose pin at the cursor (a second click moves it); the human's submit pins there, falling back to the map centre when nothing was clicked; closing the popover or submitting clears the draft. Draft location lives in a UI store next to `draw-store.ts`, never in `map-store.ts`, so no tool can see it. An `agentInvoked` submit ignores the draft and pins at `view.center` exactly as today | map-ui-dev → qa → review | doing | Feature taps are suppressed while the popover is open, as in draw mode; draw mode keeps precedence over note placement |

## T-107 — a folded note can be unfolded · owner report 2026-09-02 · gate: no gesture on a note leaves it unreadable with no way back

Owner: "a note disappears when clicked, and there is no way to bring it back." Root cause in `annotation-marker.ts`: a click on the bubble toggles `.pin-card.hidden` (`display: none`), and a click on what remains — a 9 px anchor and a 1.5 px stem — opens the "On the map" card rather than unfolding the bubble. The fold is one-way in practice.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-107 | A click on a folded pin unfolds it (and does nothing else); a click on the bubble folds it as before; a click on the stem/anchor of an unfolded pin opens the "On the map" card as before. A folded pin must stay visibly clickable — keep a compact chip (the source dot with the note's first word or an ellipsis) rather than a bare anchor, so the way back is on screen. Same PR as T-106 | map-ui-dev → qa → review | doing | Agent-facing behaviour unchanged: annotations, ids, `annotate`/`add_note`/`remove_from_map` untouched |

## T-108 — the "On the map" card shows the whole note · owner report 2026-09-02 · gate: a person can read every character of a note somewhere on the map, whatever state the pin is in

Owner: after folding a pin and reopening it, a long note is cut to "…" and there is no way to read the rest. Root cause in `card-model.ts:220`: the card's headline is `truncate(annotation.note, CARD_NOTE_CHARS)` with `CARD_NOTE_CHARS = 72`, while a note may be `MAX_NOTE_CHARS` (200) long; the card has no other line that carries the note, and with the bubble folded (T-107) the text was on screen nowhere.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-108 | The card for a note shows the full note text, wrapped (`pre-wrap`, `overflow-wrap: anywhere`), instead of a 72-character headline; `CARD_NOTE_CHARS` and the "clips a long note" unit test are replaced by a test that pins the whole-note intent. Card placement already re-measures through `ResizeObserver`, so a taller card still flips above/below correctly. Same PR as T-106/T-107 | map-ui-dev → qa → review | doing | Feature and drawing headlines unchanged |

## Follow-ups (ticketed, unscheduled)

- **F-1 (qa)** `awakening.spec.ts:672` — the flake family's last site: `stateAfterWaking` returns ~600ms into the story, then two Node-side locator assertions race the remaining ~1200ms of the `disabled` window; fold the reads into the same in-page tick. Pre-existing; deterministic-failure mode once the story lands.
- **F-2 (map-ui-dev)** idle-chrome `.hint`/`.attribution` ~13px overlap at 1240 AND 1440 (measured with the search box display:none — pre-existing); fix together with adding "search" to the landing hint (the hint grows into the same overlap; choreography only writes opacity to it, so copy is safe).
- **F-3 (data-engineer)** address generation guard: 152 addresses are a bare city name, 243 carry no street/號 — require a street token before emitting; also 19 `addr:full` values carry upstream city/district duplication verbatim (documented choice, revisit if judges notice).
- **F-4 (docs-writer)** ~~README narrative debt~~ **closed 2026-09-01** by T-41 (README) and PR #89 (the `get_place_details` ask card).
- **F-5 (orchestrator)** Overpass endpoint rot: overpass-api.de and kumi.systems both failed all attempts this export; only the .fr mirror answered. Reorder ENDPOINTS or note the operational reality before the next data re-run.
- **F-6 (map-ui-dev, design question)** `SelectedRow.details` is computed for sidebar rows and never rendered (T-96 ratified narrowing) — revisit only if the owner wants details in the list too. *Earned its keep 2026-09-01: the README pass asserted the inspector renders those fields, and this line is what caught it.*
- **F-7 (map-ui-dev)** `useFeatureData` runs six bare `fetch` calls with no timeout, so one hung request pins `baseDataLoaded: false` forever and every name lookup then invites an infinite retry. Before T-103 that page answered wrongly; after it, it stalls. Add `AbortSignal.timeout(...)` to `loadCollection`, or resolve the flag on settle rather than on `Promise.all` — the tier-2 side already does this (`src/lib/store/tier2.ts:207-250`).
- **F-8 (qa)** No e2e for the T-103 race. Needs a spec that stalls `/data/*.geojson` behind a `find_features({near:"Daan Station", categories:["post_office"]})` call and asserts the refusal, not `osm:way:206062024`. Every existing spec waits for the data first, so the suite structurally cannot regress here.
- **F-9 (tool-dev)** In the same load window, `set_map_view({feature_id})`, `measure({target})` and `get_place_details({id})` answer `unknown feature_id` / `unknown target` for a bundled id. Loud, never a confident wrong answer, and `base_data_loading` on map state now lets an agent see why — but the remedy `get_place_details` prescribes ("use find_features") is the path that was silent until T-103.
- **F-10 (docs-writer)** `docs/design/ui-redesign-handoff.md` still describes a standalone bottom-left "legend" component in at least four places (the component-inventory row naming `StateOverlay.tsx`, two breakpoint rows, two design-token rows); it is now `MapKey.tsx` / `PlacesTray.tsx`. Assessed during T-41 and deliberately not fixed there: correcting it honestly means re-verifying the current responsive behaviour, not renaming a word. Supersedes the 2026-08-31 T-91 handoff.
- **F-11 (tool-dev)** `src/lib/map-tools/share.test.ts:545` says "The sender has 2297 cafes in memory"; the manifest says 2,298. Harmless fixture prose, but it is the last site of a stale count corrected everywhere else in PR #89.
- **F-12 (map-ui-dev)** Two camera moves still sit outside T-104's `flying` invariant (`MapCanvas.tsx`): the cluster-expansion `map.easeTo` is cancelled by a corridor change during its 500 ms and not re-issued (no agent was promised that landing, so loud-but-harmless), and `load`'s second `pushViewFromMap()` would clear `flying` if a flight were in the air when the style loads. Both pre-existing; review 1 charged neither. Review 2 added a third, same class: a resize while NOT flying still runs `applyPadding()` before MapLibre's own resize, so `bounds` is published against the old width for one rendering update — `map.resize()` first on both paths would close it (`onResize = () => { map.resize(); applyPadding(); if (flying) pushBoundsFromMap(); }`), deferred to keep T-104 to the flight case.

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
- 2026-08-29 · qa/map-ui-dev → orchestrator · "Hide" collapses only the inspector body; the glass lane still covers the map, so bounds keep excluding it (correct). If Hide should return the lane to the map, that is a layout decision — padding and bounds would follow for free.
- 2026-08-30 · orchestrator → all · Tier-2 approved by the user (time explicitly not a constraint; agent-parallel build). Integration on develop only; main stays demo-stable until the whole package is green. Category taxonomy and interface contracts are fixed in the dispatches.
- 2026-08-30 · qa → orchestrator (decision logged) · the toMap re-entrancy guard is only exercised by the opt-in live-basemap spec (isolation forces jumpTo); accepted live-only exercise for now.
- 2026-08-31 · qa → map-ui-dev · MapCanvas.tsx:633 comment says a bead tap deselects; it opens the card (correct behavior, stale words) — cosmetic, ride any next components pass.
- 2026-08-31 · suite lesson (recorded) · timing checks against animations must anchor to the browser's clock (MutationObserver + performance.now in one evaluate); Node-side polls across IPC lose races on shared runners — three instances fixed in fx.spec.ts.
- 2026-08-31 · orchestrator → all · The 2026-08-28 line "delete is UI-only" is superseded by T-90: `remove_from_map` gives agents removal of agent-sourced drawings/annotations and any selection entry; user-sourced marks stay human-only (refused per-id with the reason).
- 2026-09-01 · orchestrator → all · `CONTRIBUTING.md` English rule relaxed: a genuine place name may be quoted inside English prose (a comment or commit message), because `gazetteer.ts:32-33` cannot explain the 大安 / 大安森林公園 disambiguation without naming it. CJK sentences are still banned. The rule text was out of date, not the code.
- 2026-09-01 · orchestrator → all · `scripts/ship-pr.sh --merge-back` runs `git switch` in the repo root, which fails when the head branch is checked out in a worktree. Merge `origin/develop` inside the worktree instead, then ship without the flag — and it is the better order anyway, because the integration check then runs against the base you are merging into.
- 2026-09-01 · review → all (lesson) · Four of the T-41 README defects were the same shape: prose describing what a surface was *designed* to do rather than what the component does. Read the component before the sentence, not the sibling doc.
