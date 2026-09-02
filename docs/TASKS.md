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
| T-111 | README says who did what: a "Who did what" passage in "One map, two hands" — provenance on every mark, visible to both sides; every tool call on the activity feed with its outcome and the ids it touched (the last 50, errors included); an agent cannot remove a human's mark; a share link keeps provenance — plus one bullet each for the two new human gestures (T-106 note placement, T-110 route). Owner asked 2026-09-02 for the separation of agent and human trails to be stated; wording stays at "a legible record", never audit/verify/tamper-proof, because the feed is session-only and capped | docs-writer → review | done | Shipped after T-110 (#99) so the README never describes an unshipped gesture; also widened the two "only `plan_route` calls an external service" sentences to routing's two callers (T-110 review S1) and refreshed the test count |

## 2026-08-29 … 2026-09-02 · shipped rounds · all `done`; detail in [`docs/TASKS-archive.md`](./TASKS-archive.md)

- **UI redesign — "Smoked Glass"** (T-50…T-54) · **Tier-2 OSM breadth** (T-60…T-66) · **Agent-presence FX** (T-70…T-72) · **The Awakening** (T-80…T-85) · **UX feedback round** (T-90…T-95) · **UI-parity round** (T-96…T-99).
- **T-100/T-101** search index + actionable inspector rows · **T-102** query and camera parity · **T-103** load-window place-name race · **T-104** the awakening no longer cancels an agent's flight.

## T-106 — a human pins a note where they click · owner request 2026-09-02 · gate: a person's note lands under their cursor, an agent's exactly where it landed before

Owner: the Note pill is unfriendly to a person — the form pins only at the map centre, so placing a note means panning the whole map until the spot is under the crosshair. Human side only: the declarative `add_note` tool (its `toolname`, `tooldescription`, `toolparamdescription`, and an agent-invoked submit landing at `view.center`) does not change, and neither does the imperative `annotate`.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-106 | While the Note popover is open and draw mode is off, a map click places a provisional rose pin at the cursor (a second click moves it); the human's submit pins there, falling back to the map centre when nothing was clicked; closing the popover or submitting clears the draft. Draft location lives in a UI store next to `draw-store.ts`, never in `map-store.ts`, so no tool can see it. An `agentInvoked` submit ignores the draft and pins at `view.center` exactly as today | map-ui-dev → review → qa | done | Feature taps are suppressed while the popover is open, as in draw mode; draw mode keeps precedence; `Escape` leaves note mode. Review caught an agent `add_note` wiping the human's half-placed draft — an agent submit now neither reads nor spends it. e2e `note-human-gestures.spec.ts` pins the whole contract incl. the agent-at-centre invariant |

## T-107 — a folded note can be unfolded · owner report 2026-09-02 · gate: no gesture on a note leaves it unreadable with no way back

Owner: "a note disappears when clicked, and there is no way to bring it back." Root cause in `annotation-marker.ts`: a click on the bubble toggles `.pin-card.hidden` (`display: none`), and a click on what remains — a 9 px anchor and a 1.5 px stem — opens the "On the map" card rather than unfolding the bubble. The fold is one-way in practice.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-107 | A click on a folded pin unfolds it (and does nothing else); a click on the bubble folds it as before; a click on the stem/anchor of an unfolded pin opens the "On the map" card as before. A folded pin must stay visibly clickable — keep a compact chip (the source dot with the note's first word or an ellipsis) rather than a bare anchor, so the way back is on screen. Same PR as T-106 | map-ui-dev → review → qa | done | Agent-facing behaviour unchanged: annotations, ids, `annotate`/`add_note`/`remove_from_map` untouched. Fold state lives only in the pin's DOM (`data-folded`), never in `map-store` or the share hash |

## T-108 — the "On the map" card shows the whole note · owner report 2026-09-02 · gate: a person can read every character of a note somewhere on the map, whatever state the pin is in

Owner: after folding a pin and reopening it, a long note is cut to "…" and there is no way to read the rest. Root cause in `card-model.ts:220`: the card's headline is `truncate(annotation.note, CARD_NOTE_CHARS)` with `CARD_NOTE_CHARS = 72`, while a note may be `MAX_NOTE_CHARS` (500; the human form's own input caps at 200) long; the card has no other line that carries the note, and with the bubble folded (T-107) the text was on screen nowhere.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-108 | The card for a note shows the full note text, wrapped (`pre-wrap`, `overflow-wrap: anywhere`), instead of a 72-character headline; `CARD_NOTE_CHARS` and the "clips a long note" unit test are replaced by a test that pins the whole-note intent. Card placement already re-measures through `ResizeObserver`, so a taller card still flips above/below correctly. Same PR as T-106/T-107 | map-ui-dev → review → qa | done | Feature and drawing headlines unchanged. Review found the un-capped card: `"a\n".repeat(250)` grew it off the top of a phone viewport, so the note block is capped at `25vh` and scrolls (40vh measured and rejected — `cardPlacement` can only guarantee a side that fits while the card is under half the viewport) |

## T-109 — the loaded-categories strip ran under the Places dock · owner report 2026-09-02 · gate: nothing in the bottom band covers anything else, at any width, with any number of categories loaded

Owner: "with many categories loaded the strip grows from the bottom-left and overlaps the Places dock." Measured: 22 of 40 (width × chips × chrome) cases overlapped, up to 720 × 43 px. Root cause: `.poi-strip` wraps and grows right; `.dock` is absolutely centred and out of flow; nothing bounds the strip's right edge against the dock's left. Found while measuring: with three categories browsed the two-row dock **covered the OpenStreetMap attribution** at 641–1240 px (up to 87 px) — a licence condition.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-109 | The dock publishes its own width as `--dock-w` (ResizeObserver, no React state); above 640 px `.poi-strip` and `.corner` cap at `(100% − var(--dock-w)) / 2 − 16px`, and the attribution wraps instead of being covered. Correct by construction because the dock is centred on the bar in both chromes | map-ui-dev → review → qa | doing | Alternatives weighed and rejected in the PR: a summary chip past N, a static max-width (no constant works — the agent lane moves the gutter), one flex row (touches the tray anchor, landing hint and four media queries) |

## T-110 — a person plans a walking route by clicking two points · owner approved 2026-09-02 · gate: the human can do what `plan_route` does, and the agent's tool is untouched

Owner asked how a human uses routing; the answer was "only through an agent". Parity gap of the T-102 kind, the other way round.

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| T-110 | Fourth pill "Route": click a start, click an end, the same `planWalk` (shared 1 req/s throttle, not re-implemented — a unit test finds the shared queue still busy after a hand-planned walk) draws a `source: "user"` line labelled `walking route · 1.2 km · 16 min`; a refusal shows the service's sentence in the hint and leaves the person in route mode; `Escape` cancels. A human route latches the FOSSGIS credit exactly as an agent's does | map-ui-dev → qa → review | done | Nothing under `src/lib/**` changes; `remove_from_map` keeps refusing human marks, so an agent cannot remove a human's route. Review: no blockers; README and CONTRIBUTING wording widened to name both callers of the routing service (README half rides T-111). e2e `route-human-gesture.spec.ts` pins all seven contract points |

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
- **F-13 (tool-dev)** No tool echoes an annotation's coordinate: `AnnotationOutput` (`state.ts:55`) carries `id`, `note`, `source` only, so an agent that pinned a note by place name cannot confirm where it landed without re-resolving the name itself. Found writing the T-106 e2e, which had to read the store directly. Adding `at: [lng, lat]` (5 dp) costs ~30 B a note.
- **F-14 (map-ui-dev)** At ≤640 px the loaded-categories strip overflows the bottom bar's left edge by 6–22 px (`.bottom-bar` is `justify-content: flex-end` and `.corner` is `flex-shrink: 0`, so overflow goes left). Text stays readable. Fix is letting `.corner` shrink at that tier — not `safe flex-end`, which would push the attribution off the right instead. Found during T-109.
- **F-15 (map-ui-dev)** `.pin-card` has `max-width: 210px` and no `max-height`: `annotate` with `"a\n".repeat(250)` renders a ~4,400 px bubble that covers other pins. The fold (T-107) is the current escape hatch. A companion cap (`max-height` + fold-on-overflow, or collapsing interior newlines in the bubble only) is a design call. Found during T-108's review.
- **F-16 (qa)** `e2e/awakening-flight.spec.ts:249` reads bounds immediately after `setViewportSize` and races the republish (~4/24 on develop). Same family as F-1; the fix is a wait on the republished bounds, never a sleep. Handed to qa 2026-09-02.

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
- 2026-09-02 · qa → all (lesson) · Every tool call writes an activity row, read-only ones included — `get_map_state` too. "A human gesture writes no row" is only assertable before the next tool call, so an e2e that checks it must read the store, not call a tool, or assert before the first call.
- 2026-09-02 · orchestrator → qa · `e2e/awakening-flight.spec.ts:249` flakes ~4/24 on develop: it reads bounds right after `setViewportSize` with no wait for the republish. Wait for the republished bounds (no fixed sleep). Ticketed F-16.
- 2026-09-01 · review → all (lesson) · Four of the T-41 README defects were the same shape: prose describing what a surface was *designed* to do rather than what the component does. Read the component before the sentence, not the sibling doc.
- 2026-09-02 · qa → tool-dev · Beads are tier-2/browse-only: a selected *bundled* feature paints a selection ring, and its clickable render is its category's circle layer (`INTERACTIVE_LAYER_IDS`), not `BEAD_LAYER_IDS`. A spec that needs to tap a selected station must query the interactive layers.
