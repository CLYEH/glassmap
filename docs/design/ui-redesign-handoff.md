# UI redesign handoff — "Smoked Glass"

> Copied verbatim from the design iteration's final rationale (v5, SHIP verdict after a
> five-round adversarial review, 2026-08-29). The mockup (`mockup-v5.html`), render
> shots, and the rounds 1–4 rationales/findings it references live in the design
> session's workspace outside the repo; the sections from "SHIP-GATE" onward are
> self-contained for implementers.

---

# GlassMap redesign v5 — "Smoked Glass", final polish per review round 4

R4's verdict was REVISE (final polish; round 5 is the SHIP round): one MINOR (the
demo script invisible on the sheet tier at landing) plus four declaration-level
nits. v5 is exactly that patch. Nothing structural moved: the diff v4→v5
(version strings normalised) is 47 lines — one DOM section inside the sheet-only
Activity pitch, two SVG paint edits on the camera glyph, one `document.fonts.ready`
line, and comments. No breakpoint, cap, plate, overlay-data, token, or desktop
DOM change of any kind. Read `rationale-v3.md` for the layout system and
`rationale-v2.md` for the plates' provenance; both stand whole.

**Plates and overlay data are byte-identical to v2/v3/v4** (nothing re-captured).
Hashes are **sha256** (r4 finding 4 — labeled, and sha256 from now on):

- `map-v2-z12-calm.png` `dc600abda7bfed6f1293f6a6e68b1573dcf6df46ebd45e284219f24288e1adfd`
- `map-v2-z15-busy.png` `eb3a9444c109273368739cf63c884285b1e8ce0c5601f7ea46a9d293c60563a9`
- `dots-z12.js` `f2f83abe4097f1d760daa538feea6044ec0bb7e21a46bcd0836a424fe607041b`
- `halos-z15.json` `aad52fc845b0618d4b2aa4ab5d2f6e9c166ee629eede6cffeb36605ad1203bed`

## Declared pixel deltas v4→v5 (for the pixel-diff)

1. The camera chip's glyph, both states, every width ≥601 (crosshair ticks — fix 3).
2. The sheet-tier landing (≤920, default): the Activity pitch gains a Try-asking
   section between the copy and the chip roster (fix 1).
3. The sheet-tier busy feeds rest 8px lower — now exactly at the newest call
   (fix 2); the top-edge fade ghost shifts by the same 8px.

Nothing else. Desktop busy/default at 921+ differ from v4 only by delta 1.

## Findings → fixes (every r4 finding)

| r4 # | Sev | Finding | Status in v5 | How / evidence |
|---|---|---|---|---|
| 1 | MINOR | The demo script is invisible on the entire sheet tier at landing: Activity pitch shows dead space, Try-asking cards sit below the fold in Contents | **Fixed — cards surfaced (the acceptance's first branch)** | The two strongest Try-asking cards now ride the Activity pitch itself, so the sheet tier lands on the demo script with zero interaction. Branch argument below. Placement: the cards sit **above** the chip roster, not under it as the acceptance's example sketched — measured reason: at 390 the under-chips placement puts the first card at y738–810 while the scroll fold is at ~y772, shearing the question mid-glyph; above the chips both cards are whole (measured y627–699 and ~y705–760 at 390; at 800 the entire pitch + chips + cards fit with zero overflow). The chip roster takes the scroll cut instead — it is the one pitch element whose information survives elsewhere on the same screen ("12 tools" in the ticker and badge), and it stays one swipe away. Cards chosen: card 1 (spoken verbatim it produces exactly the busy state — the strongest demo) and card 4 (the r4-verified `find_features · measure` chain, one line). All four cards still live under Contents, unchanged. Shots: `v5-390-default.png`, `v5-800-default.png`, crops `v5-crop-sheet-pitch-{390,800}.png`. The former ~115px dead band at 800 is now content. |
| 2 | NIT | Cold-load sheet feed rests 8px shy of newest (scroll set before webfonts load) | **Fixed — one line** | `if (document.fonts) document.fonts.ready.then(syncTabButtons);` re-syncs the rest-at-newest scroll after font reflow. Measured on the v5 renders (`shots/v5-measure.json`): `.insp-body` scrollTop == scrollMax at every busy sheet width — 31/31 at 769 and 800, 57/57 at 390 (r4 measured 23/31 and 49/57). The Listening row keeps its full bottom padding in `v5-800-busy.png` / `v5-390-busy.png`. |
| 3 | NIT | Camera chip and Selected header share one circle-dot glyph for two meanings | **Fixed — crosshair ticks on the camera glyph** | The camera glyph (both state chips) is now a scope: circle r3.2 + centre dot + four crosshair ticks. The Selected header keeps the plain circle-dot. Two concepts, two symbols. `v5-crop-cam-chip.png` (2x): ticks legible at rendered size. Paint-only SVG edit; the Selected header SVG is untouched. |
| 4 | NIT | "Byte-identical" hashes were MD5, unlabeled | **Fixed in this rationale** | Hashes above are sha256 and say so. Standing rule for future rounds: label the algorithm, prefer sha256. No mockup change (none was asked). |
| 5 | NIT | "2,063 features loaded" (feed) vs "2,063 places" (legend) — one number, two nouns | **Declared — the voice split is deliberate and stays** | The feed speaks the tool's vocabulary: the row summarises `get_map_state`'s own return, which counts *features* — rewriting it to "places" would put words in the tool's mouth. The legend speaks to humans: *places*. Machine voice in mono where the agent acts, human voice where the person reads — the same grammar that separates the mono tool names from the sentence summaries. Copy unchanged; this paragraph is the declaration the acceptance asked for. |

r4's fade-ghost observation was ruled closed (not a finding); nothing done. Note the
8px re-sync (fix 2) shifts which fragment ghosts at the sheet feed's top edge —
still the accepted fade branch behaving as declared.

Contrast re-measured on the v5 renders (`check-contrast-v5.mjs`, the r4 sampler's
10 regions renamed to v5 + 2 new regions on the surfaced pitch cards): 12/12 PASS,
worst 4.59:1 (the same inspector-card-meta-over-teal region every round measures);
the new sheet-pitch cards measure 7.0:1+ on both widths.

## SHIP-GATE — repo hand-off (blocking demo day, outside the mockup)

**`src/components/WebMcpProvider.tsx` badge copy must count the declarative
`add_note` form by demo day — render "12 tools" (11 imperative registrations +
the `AddNoteForm.tsx` `toolname="add_note"` form) or "11 tools + this form" —
else revert the design copy to 11 everywhere it appears** (badge `.badge-tools`,
feed-mini "12 tools ready", ticker "12 tools", and drop the `add_note` chip from
both landing chip lists). Today `WebMcpProvider.tsx:21/37` counts only
`reg.toolNames.length` = 11, so production on-screen contradicts the design's
count until the orchestrator lands this one-line copy fix. Design keeps 12, per
r4 ruling (ii).

Second standing gate (optional): pin-anchor nudge a few metres on the next plate
re-bake (r3 #6, accepted).

---

# FINAL HANDOFF

Everything an implementer needs, in one place. The mockup is `mockup-v5.html`;
the system below is its single source of truth.

## Design-system tokens

### Color

| Token | Value | Used for |
|---|---|---|
| `--ink-0` | `#0a0d12` | page ground |
| `--panel` / `--panel-2` | `#10141b` / `#131822` | opaque fills (read-call dot) |
| `--glass` | `rgba(12,16,22,.88)` + top sheen `linear-gradient(180deg, rgba(255,255,255,.045), transparent 42%)` | all floating chrome (brand, cam, share, feed, draw, legend, badge) |
| `--glass-strong` | `rgba(8,12,17,.92)` | note-pin card |
| `--sheet` | `rgba(9,13,19,.90)` | desktop inspector |
| mobile sheet | `rgba(13,17,23,.97)`, no blur | ≤920 bottom sheet (declared material exception — nothing is behind it) |
| `--hairline` / `--hairline-2` | `rgba(255,255,255,.10)` / `.06` | borders / inner rules |
| `--text-hi` / `--text-mid` / `--text-low` | `#f2f5f7` / `#b9c3ce` / `#9aa7b4` | 3-step text ramp |
| attribution | `#ced6dd` on `rgba(9,12,17,.78)` | MapLibre attribution pill |
| `--agent` / `--agent-deep` | `#2dd4bf` / `#0b7285` | agent tint on dark glass / canvas value (= `DRAWING_COLOR.agent`) + halo ring |
| `--human` / `--human-deep` | `#f48fb1` / `#c2255c` | human tint on dark glass / canvas value (= `DRAWING_COLOR.user`) + Pin-note button |
| `--live` | `#4ade80` | WebMCP-live dot |
| `--c-mrt/park/school/market/listing/district` | `#d7263d #2f9e44 #1c7ed6 #f08c00 #9c36b5 #495057` | **exact** `CATEGORY_COLOR` from `src/components/map-style.ts` — legend and map must match |

Semantics: **teal = agent, rose = human**, everywhere, both canvas and chrome.
The tints are declared brighter stops of the canvas values (contrast on dark
glass); do not swap tint and canvas values.

### Type

| Token | Value |
|---|---|
| UI face | Inter (via `next/font`), fallback -apple-system/Segoe UI |
| Data face | JetBrains Mono — tool names, ids, coords, counts, timestamps |
| Scale | 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14.5 px; 9px only for the uppercase wide-tracked pin tag |
| Floor | nothing below 10px except that one 9px uppercase tag (measured 8.8:1) |
| Weights | 400 body · 550–570 titles-in-cards · 600 mono-emphasis · 620–650 headings/buttons |

### Radii, blur, shadow, spacing

| Token | Value |
|---|---|
| `--radius` / `--radius-s` | 14px panels+chips / 9px cards; 8px inputs+rows; 20px count pills |
| Blur | 18px chrome chips+feed · 14px desktop inspector · 12px pin card · 8px attribution · 0 mobile sheet (all with `saturate(150–160%)`) |
| Shadow | one shadow everywhere: `0 12px 32px rgba(3,7,13,.42), inset 0 1px 0 rgba(255,255,255,.06)` |
| Spacing | 4px grid; 14px map-edge gutter (12px ≤920); feed width 302px; sheet content column centred `max-width: 660px`; sheet height 46vh |
| `--lane` | 336px (>1240) / 300px (≤1240) — drives inspector width, draw-chip and bottom-bar geometry |
| Scroll fade | 12px top `mask-image` ramp on both live feeds |

### Breakpoints (all verified busy in shots across five rounds)

| Range | Layout |
|---|---|
| ≥1361 | full everything |
| 1241–1360 | badge drops `navigator · document`; legend abbreviates "Supermarkets"→"Markets" |
| 921–1240 | mid tier: lane 300, legend collapses to pill+popover, busy feed default-collapsed; busy expanded feed capped `max-height: calc(50vh - 145px)` so it ends above the pin card |
| 601–920 | sheet tier: full-width map over 46vh bottom sheet, Contents/Activity tabs, ticker; camera chip + labelled Draw survive |
| ≤600 | phone: no camera chip, icon-only Draw |

The 921 lower bound of the desktop tier is geometric, not taste: below it the busy
plate's 545px halo span cannot fit the corridor beside a 300px lane (rationale-v3).

## Component inventory — old → new, costs mapped to real files

| Old (repo file) | New | Cost |
|---|---|---|
| `src/components/StateOverlay.tsx` (debug dump) | Brand chip (logomark + GlassMap + TAIPEI) + camera chip (mono lat/lng/zoom; **crosshair glyph** — must stay distinct from the Selected header's circle-dot) | S |
| `src/components/StateOverlay.tsx` (legend) | Legend strip, bottom-left, real per-category counts from the store; collapsed count-pill + labelled popover ≤1240 | S |
| — | **Agent activity feed** (hero): timeline rows, write=filled teal dot / read=hollow, Listening row, collapse pill, empty-state pitch; 12px top fade; rest-at-newest + `fonts.ready` re-sync | **M** (wiring below) |
| `src/components/DrawToolbar.tsx` | Draw-polygon chip, top-right, rose pentagon; keeps the vertex-count hint as a sub-row when active | S |
| `src/components/Sidebar.tsx` | Inspector: Selected / Shapes / Notes (rows, cards, remove ✕, designed empty states) + landing-only Try-asking section; ≤920 becomes the sheet's Contents tab | M |
| `src/components/AddNoteForm.tsx` | Pin-note form, pinned below the scroll area; **never `display:none`** (declarative `add_note` tool) | S |
| `src/components/WebMcpProvider.tsx` | WebMCP-live badge, bottom-right (green pulse · "WebMCP live" · tool count · surfaces) — **carries the 12-tools ship-gate above** | S |
| `src/components/ShareStatus.tsx` | Behaviour unchanged; too-large warning as an amber glass chip above the corner stack | S |
| `src/components/annotation-marker.ts` | Note pin: glass card (source tag + text) + stem + white-ringed teal anchor — DOM marker exactly as today | S |
| `src/components/map-style.ts` | z≤13 calm ramp (radius 2, opacity .55, stroke .5), `minzoom: 14` on `gm-mrt_station-label` + `gm-listing-label`, **new selection-halo layer** (white-cased `#0b7285` ring at selected feature centroids) | S |
| — | Mobile sheet (46vh, grab handle, Contents/Activity tabs) + last-call ticker | M (CSS + tab state) |

Layout plumbing: map is full-bleed; desktop inspector overlays it with
`map.setPadding({ right: laneWidth })` so the camera centre stays honest (one line
in `MapCanvas.tsx`).

## New components (net-new, not restyles)

1. **Activity feed wiring — from the tool execute path.** Wrap each tool's
   `execute` where the tools are created — `createMapTools` in
   `src/lib/map-tools/index.ts` — pushing `{ tool, ok, t: Date.now(), summary }`
   into a new zustand slice in `src/lib/store/map-store.ts` (cap 50). Summaries
   are deterministic pure-string per tool from input/result ("Circle, 800 m —
   \"10-min walk\" → drawing:1") — no model in the loop. This one slice also
   feeds the mobile ticker (last entry) and the call counter for free; e2e
   asserts rows via `data-testid`. **Ownership note:** do NOT wire this in
   `src/lib/webmcp/register.ts` — `src/lib/webmcp/**` is orchestrator-owned;
   the `createMapTools` decoration keeps it in tool-dev territory.
2. **Share chip** (next to the camera chip): `navigator.clipboard.writeText(location.href)`
   — `useShareHash` already carries full state in the hash; label swaps to
   "Copied" inline. **No modal, no `alert`** (hard project rule).
3. **Scrims**: top 130px / bottom 90px gradient overlays seating chrome on the
   map, `pointer-events: none`.
4. **Try-asking cards**: static copy component (things to SAY to the agent, not
   buttons), rendered in two landing-only places — the Contents/inspector section
   (≥921) and the sheet Activity pitch, **above** the chip roster (≤920). The
   four prompts and their tool tags are verified against
   `src/lib/map-tools/index.ts` + `gazetteer.ts` + the bundled data (r4 required
   checks a/b); if the copy ever changes, re-verify resolution first-call
   uniqueness — "Daan District"/"Xinyi District" resolve uniquely, bare
   "Daan"/"Xinyi" do NOT (station exact-match / 6-way ambiguity).

## Honesty caveats every future implementer must know

1. **Plate provenance.** Both map plates are production captures
   (`capture-v2.mjs`, raw output in `capture-log.json`), byte-identical since v2
   (sha256 above). The landing plate was captured with the four point datasets
   served empty; its calm dots are a mockup SVG overlay drawn from the real
   projected data at the **proposed** z≤13 style — production does not render
   this yet (that's the `map-style.ts` item). The busy plate's circle and
   selection fills are baked production pixels after real shim tool calls; the
   **halo rings are the proposed selection-halo layer**, drawn by the mockup at
   the parks' real projected centroids — also not production yet. Baked labels
   go soft at 0.82×/0.73× cover-fit scales; the remedy, if the demo video needs
   it, is a deviceScaleFactor-2 re-capture (contained half-day), at which point
   also nudge the pin anchor off the baked "10-min walk" label (r3 #6).
2. **The 12-tools gate.** See SHIP-GATE above. The design's every count (badge,
   ticker, collapsed pill, both chip lists) says 12 = 11 imperative + declarative
   `add_note`. That is the agent-visible truth, but production's counter says 11
   until `WebMcpProvider.tsx` is fixed; do not ship the mismatch on demo day.
3. **Feed-order truth.** The mockup's feed moves `get_map_state` to the front as
   the story's opener — a declared reading-order edit of the real captured
   sequence (r3 #5). The real feed component must render true chronological
   order and real summaries; never re-order for storytelling in the product.
   Timestamps and the "quiet" header word are staged; "6 calls" = 5 captured
   calls + the staged `annotate` (annotations are DOM markers, nothing baked).
4. **capture-log stale-bounds annotation.** In `capture-log.json`,
   `set_map_view`'s return carries pre-flight (z12) bounds inside z15 entries —
   the camera resolves before `moveend` settles when calls fire back-to-back.
   The log is kept raw on purpose (evidence stays unedited); flagged since r2 as
   a likely repo bug in the tool's return path. Anyone re-verifying returns
   against the log must expect it.
5. **Voice split.** Feed says "features" (tool vocabulary, from
   `get_map_state`'s return); legend says "places" (human vocabulary). Same
   number, two registers, deliberate (r4 #5 declaration above).
6. **Contrast margin.** Worst measured region is the inspector-card meta over
   the teal circle at 4.57–4.59:1 — just-passing every round. Do not darken
   `--text-low`, lighten that card background, or thin the glass alpha without
   re-running the sampler (`check-contrast-v5.mjs`).
7. **Fade behaviour.** The 12px top fade on both live feeds deliberately
   swallows whatever the rest-at-newest edge clips; it often eats a row's mono
   tool-name head and leaves the grey summary as the first visible line —
   inherent to the accepted branch, ruled fine in r4, don't "fix" it.
8. **Sheet-tier dot scale.** At ≤920 the landing plate's calm dots render at the
   plate's cover-fit scale (~0.55×), slightly smaller than the real
   `map-style.ts` treatment would draw at that window — mockup-only artefact.
9. **Hard rules that shaped the design:** no `alert`/`confirm`/`prompt`
   (modals lock the agent), the `add_note` form must never be `display:none`,
   English-only repo, no WCAG/accessibility compliance claims — the phrase is
   "agent-mediated map access".

## Render & verification

- `render-v5.mjs` → `shots/`: the mandated matrix `v5-{1440,1280,960,800,390}-{busy,default}`
  (10 frames) + diagnostics `v5-769-busy`, `v5-925-busy`, `v5-390-default-contents`;
  2x crops `v5-crop-{sheet-pitch-800,sheet-pitch-390,cam-chip,sheet-top-800}`;
  scroll/card measurements in `shots/v5-measure.json`. All 17 frames read back
  before this report. Layout survival spot-read at 769/800/925/960/1440: cam
  chip, labelled Draw chip, pin card, circle and all 8 halos in frame; no chrome
  collisions.
- `check-contrast-v5.mjs`: 12 regions (r4's 10 + the two surfaced pitch-card
  regions), all PASS ≥4.5:1, worst 4.59:1.
- Scroll re-sync verified numerically: scrollTop == scrollMax at 769/800/390 busy.

## Cost delta vs v4

Pitch cards on the sheet tier (XS, one section of existing card markup), fonts
re-sync (XS, one line), camera glyph (XS, one SVG). Real-app estimate unchanged
at ~1.5–2 days. No new dependencies.
