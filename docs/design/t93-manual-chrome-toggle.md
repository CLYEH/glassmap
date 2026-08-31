# T-93 design: manual agent-chrome toggle — v2 (post-review)

Status: v2, incorporating the adversarial review of 2026-08-31. The v1 draft
proposed reusing the awaken machine's `idle`/`awake` for manual flips; the
review demonstrated that design fails four ways (reopen-on-next-call,
corridor/bounds corruption, destroyed choreography, remount reopening). v2 is
the binding contract. This file rides the T-93 PR into `docs/design/`.

Owner ask (2026-08-31): agent mode can only start via a WebMCP call; once open
it cannot be closed; wanted: manual open AND close, default collapsed behind a
button.

## Architecture: a panel store, the machine untouched (review B1/B4)

- `AwakenMode` machine (`src/lib/awaken/`) is NOT modified. One-way,
  controller-owned, `played` semantics intact, `body[data-awaken]` unchanged.
  All eleven ordering tests and the once-per-document unit tests stay
  meaningful and green. No unowned path is touched (`src/lib/awaken/**` has no
  CONTRIBUTING owner — with this design it needs none).
- New component store (src/components, map-ui-dev):
  `panel: null | "open" | "closed"` where `null` = follow the machine.
  Rendered chrome = `panel === "closed" ? human : panel === "open" ? agent :
  (mode !== "idle")`. Store- or module-scoped like `played`, so a remount
  (StrictMode double-mount, parent remount) cannot resurrect a hand-closed
  chrome (B4). No tool may read or write it (same law as browse/draw/card).
- A derived "chrome visible" fact drives BOTH `page.tsx` mounting and the
  document attribute the stylesheet keys on. The boot script and controller
  keep writing `data-chrome` for the machine path; the panel override is a
  separate attribute (e.g. `data-panel`) so the two writers never fight.

## The four behavioural rulings

1. **Manual open never enters the machine and never spends `played`** (B3).
   A visitor tapping "preview" before any agent acts must not eat the 1.8 s
   Awakening. When the first agent act later fires, the controller runs the
   story as designed; at the moment `waking` begins, the panel resets to
   `null` so the choreography plays from the clean human chrome it measures.
2. **Closed-by-hand stays closed against the agent.** Tool calls while
   `panel === "closed"` do not reopen the chrome (the machine may be `awake`
   underneath; rendering follows the panel). The collapsed control carries a
   pulse and an unseen-call count.
3. **Manual flips are instant** (no choreography); they are mount/unmount +
   stylesheet transitions. Component-state loss on unmount (feed scroll,
   inspector tab) is accepted and documented.
4. **The toggle is inert during `waking`** (review S6): disabled +
   `aria-disabled` for the 1.8 s story, so the keyboard-skip listener and the
   toggle cannot fire from one keypress.

## Where the controls live (review answer 5, adopted)

- **Open** lives inside the corner spark's card (`AgentWhisper`): a
  "Preview what an agent sees" action. No new permanent control on the
  human-first landing; the spark already is the collapsed button the owner
  asked for.
- **Close** lives in the agent chrome (near the inspector's header), labelled
  as closing the agent view. It is a different control from the inspector's
  existing "Hide" (which collapses the body and keeps the lane) — naming must
  make the difference legible; qa's corridor spec pins the semantics apart.
- Full close means the whole agent chrome unmounts, lane included: the human
  gets the whole map back. (The review's alternative — keep the content pane —
  was considered; the owner's ask is reclaiming the map, and a one-tap reopen
  is cheap. RestoredChip staying visible in human chrome is accepted: it is a
  claim about content, and the content stays on the map.)

## The corridor is the hard part (B2 — tool-output integrity)

`MapCanvas.inspectorLane()` currently derives the 336 px corridor from
`bootMode(store)`, not from what is on screen. Under a manual toggle both
directions corrupt `get_map_state().bounds` and camera padding, silently and
self-consistently. Binding requirements:

- `inspectorLane()` (and everything that consumes it: `setPadding`,
  `pushBoundsFromMap`, the browse ink budget) must be driven by the same
  "chrome visible" fact that mounts `<Inspector/>`.
- The toggle itself triggers `applyPadding()` + `pushBoundsFromMap()` — the
  existing recompute hooks watch store transitions a manual flip never makes.
- qa adds a corridor spec that asserts `bounds.west/east` against the real
  container width in both toggle directions — `midLng ≈ center.lng` alone
  stays true even when padding and bounds share the same wrong number.

## Honesty rulings (S2/S3/S4/S5)

- The feed/ticker "live" pulse is gated on `calls > 0`, not on
  `data-restored` — a hand-opened chrome on a virgin page must not animate
  the ring (this also subsumes the restored case). Empty-state copy is
  already honest and stays.
- The landing hint gates on agent-state (`isAgentState`), not on chrome mode:
  after a manual close over agent work, the hint must NOT return.
- The unseen count is `activitySeq - seqAtClose` (exact past the 50-row feed
  cap), labelled "N calls" (read-folding makes any "rows" number a lie).
- Badge: verified mode-independent (`badge-claim.ts` reads surfaces + calls);
  no change needed. No copy may assert agent presence off the panel state.
- **No persistence**: a manual close does not survive reload. The boot script
  is untouched; a reloaded restored link boots awake as today. Recorded as a
  deliberate choice (persisting would let one tap permanently disarm the demo
  on a judge's machine and make `awakening.spec.ts` reload assertions
  state-dependent).

## Acceptance criteria / spec list (qa)

e2e additions to `awakening.spec.ts`:
1. Open by hand (spark card) → badge still "Agent-readable", no pulse, feed
   empty state, `data-awaken` unchanged; then first tool call → `__awakenLog`
   contains "waking" (the story still plays).
2. Close by hand after awakening → agent calls a tool → chrome stays closed,
   toggle pulses, count equals the exact number of calls since close.
3. Close by hand → remount/reload interactions per the persistence ruling.
4. Toggle inert during `waking`; keyboard skip still lands the story exactly
   once.
Corridor spec (companion to `redesign-corridor-bounds.spec.ts`): bounds DO
move on chrome toggle, in both directions, asserted against container width;
existing "Hide does not move bounds" spec stays green.
Unit: panel-store tests (null/open/closed precedence, reset-on-waking,
remount survival); pulse gating; seq-delta counting.

## Ownership

map-ui-dev: panel store, AgentWhisper card action, close control, page.tsx
mounting, MapCanvas corridor rework, globals.css, hint gating, pulse gating.
qa: the spec list. tool-dev: none (the machine and tool layer are untouched).
Sequenced AFTER T-91 lands (both touch PlacesTray/globals.css).
