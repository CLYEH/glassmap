/**
 * The Awakening — when the page stops being a map and starts being an
 * agent-operated map, and the human watching it finds out.
 *
 * GlassMap opens as a human-first map: no feed, no badge, no lane. The moment
 * an agent acts, that has to become visible — once, unmistakably, and without
 * ever claiming an agent is here when none is. This module owns *when*, and
 * nothing else: no DOM, no React, no MapLibre, no timeline. The choreography
 * is the UI's (it reads `mode()` and drives `body[data-awaken]`), and it is
 * driven off the same store the tools write, so the trigger is a store fact
 * rather than a rendering accident.
 *
 * ## The state a mode is computed from
 *
 * Two fields, and they answer different questions:
 *
 *  - `activity` — an agent acted **on this page, now**. Only `recordActivity`
 *    writes it (`map-store.ts`), from exactly three callers: the tool-call
 *    instrumentation (`map-tools/activity.ts`, both the success and the
 *    failure path) and `AddNoteForm`'s agent-submitted branch, which is a real
 *    agent call the tool layer cannot see because a declarative form never
 *    goes through `createMapTools`. A human's own submission of that same form
 *    is deliberately not recorded — and so deliberately never wakes anything.
 *  - `restoredAgentState` — an agent acted **before this link was sent**
 *    (`restoredAgentStateOf`, `map-tools/share.ts`). Agent work, but not an
 *    arrival: there is no agent on this page to announce.
 *
 * ## Flag-first: the ordering the restore path must follow
 *
 * `applyShareHash` is a *sequence* of store writes, and every subscriber sees
 * each one. **`setRestoredAgentState(restoredAgentStateOf(decoded))` must be
 * written before any content write** (view, selection, drawings, annotations,
 * categories). Two things depend on it, one for correctness and one for looks:
 *
 *  - No restore write may ever look like an agent arriving. It cannot today —
 *    no writer in the restore path touches `activity` — so the only write in
 *    the sequence that can flip this module into agent mode is the flag write
 *    itself, and that one carries `restoredAgentState === true`, which is
 *    exactly the case the trigger below refuses. Flag-first is what keeps that
 *    argument true of a *future* restore path as well, instead of true by
 *    luck.
 *  - No subscriber may see restored content while this module still reports
 *    idle. Written last, the camera, the selection and every shape would land
 *    in front of a page whose chrome still says no agent has ever touched it,
 *    and the flip would follow the content instead of leading it. It says
 *    nothing about the first paint: the restore runs in an effect, which React
 *    reaches only after the document has been painted once — dressing that
 *    paint is the inline probe's job (`src/app/boot-chrome.ts`), and this
 *    ordering is what keeps the probe's answer and this module's from
 *    disagreeing a frame later.
 *
 * The same block carries a second bit this module never reads —
 * `setSelectionAttributionExplicit(selectionAttributionExplicit(decoded))`,
 * the evidence the restored chrome's *copy* is gated on (`store/map-store.ts`).
 * It is here for the same reason: decode-time knowledge, needed by a render
 * that happens later. Which of the two goes first does not matter — this
 * module reads only `restoredAgentState`, and a write of the other cannot
 * change `isAgentState` — but both go before the content.
 *
 * ## Contracts the UI owns (mirrored from the FX driver, which owns the map's
 * motion; this owns a one-time mode change, so it cannot live in that driver:
 * its product — the agent chrome — persists, and the driver's law is zero
 * residue)
 *
 *  - **≤ 2 s.** The choreography runs `AWAKEN_MS` and must call
 *    `completeWaking()` when it lands. If it does not, this module completes it
 *    at `AWAKEN_MAX_MS` anyway: nothing may hold the map longer, and a UI bug
 *    must not strand the page in a half-awake state.
 *  - **Kill switch** (`body[data-fx="off"]`): apply the end state and call
 *    `completeWaking()` immediately — no motion, same destination.
 *  - **Reduced motion**: an opacity-only crossfade of `AWAKEN_RM_MS`, then
 *    `completeWaking()`.
 *  - **Lifecycle**: write `body[data-awaken]` on every `onMode` call — the
 *    e2e suite waits on "awake", not on a frame. The mode values *are* the
 *    attribute values (`AwakenMode`), so the write is the mode, unmapped.
 *  - **Mount exactly one controller.** `played` is per *document*, not per
 *    controller (see below), and this module never sees the DOM, so it cannot
 *    enforce that. Two live controllers share one flag: whichever crosses
 *    first spends the story and the other reports the end state with no
 *    transition — a page that announced the agent in the badge and not in the
 *    lane. One mount, beside `FxLayer` in `page.tsx`, torn down before any
 *    remount.
 *  - **`onMode` can fire synchronously from `teardown()`.** A teardown
 *    mid-story delivers "awake" from inside the teardown call itself, which in
 *    React is the cleanup pass: the callback must be safe to run there — write
 *    the attribute, tolerate a node that is already gone, and start no
 *    animation whose end nothing is left to hear.
 *
 * ## Deviations from the design contract (§8.2 row 6, blessed)
 *
 *  1. `restoredAgentStateOf` and `selectionAttributionExplicit` live in
 *     `map-tools/share.ts`, not `components/share-hash.ts` as the inventory
 *     row places them: they are codec facts, read by tools, and the tool layer
 *     may not import from `components/`.
 *  2. `body[data-awaken]`, the freeze marker and the `__awaken` handle are
 *     named here as contracts and implemented by the UI. This module is
 *     store-only, which is what lets the eleven orderings be asserted in node
 *     rather than through a renderer.
 */

/**
 * What the page is showing, and the only three answers there are.
 *
 * These are the design's own words for `body[data-awaken]` (mockup2-v5.html
 * :53, :1332), used unchanged as this module's internal vocabulary so the UI
 * writes `mode()` into the attribute with nothing in between. "idle" is that
 * contract's name for the human-first chrome — no feed, no badge, no lane —
 * and a second vocabulary here would buy nothing but a mapping function and a
 * plausible-looking `data-awaken="human"` that no e2e selector matches.
 *
 * "waking" is the transition itself. It exists as a mode rather than as a
 * boolean beside "awake" because the UI has to be able to tell "the agent
 * chrome is arriving, narrate it" from "the agent chrome is simply here" —
 * a restored page and a remounted one are the second, and get no story.
 */
export type AwakenMode = "idle" | "waking" | "awake";

/**
 * The ceiling on the whole transition, in ms. The same law the FX driver
 * enforces with `FX_MAX_MS` (`components/fx/driver.ts`), for the same reason:
 * the calm map is the product, and no announcement of an agent may hold the
 * screen longer than a couple of seconds.
 */
export const AWAKEN_MAX_MS = 2000;

/** The choreography's own length. Inside the ceiling, with room to land. */
export const AWAKEN_MS = 1800;

/**
 * `prefers-reduced-motion`: one opacity crossfade instead of the storyboard,
 * mirroring the driver's `RM_MS`. The mode change still happens — reduced
 * motion removes the motion, not the information.
 */
export const AWAKEN_RM_MS = 220;

/**
 * The slice of the store this module reads. Structural on purpose: the app
 * hands it the Zustand store, a test hands it a bare one, and neither this
 * module nor the test needs to know the rest of the store exists.
 */
export interface AwakenState {
  /** Only its emptiness matters here; the feed is what reads the rows. */
  activity: readonly unknown[];
  restoredAgentState: boolean;
}

/** The two store methods the trigger needs (`useMapStore` satisfies this). */
export interface AwakenStore {
  getState(): AwakenState;
  subscribe(listener: (state: AwakenState, previous: AwakenState) => void): () => void;
}

/**
 * Whether the map on screen holds agent work at all. Pure, and the only
 * definition of "agent mode" in the app — the trigger, the boot mode and the
 * UI's chrome all read this one sentence.
 */
export function isAgentState(state: AwakenState): boolean {
  return state.activity.length > 0 || state.restoredAgentState;
}

/**
 * The mode a page starts in.
 *
 * A page that is already in an agent state when this module starts watching is
 * *history, not news*: it gets the end state with no story — the same
 * convention `FxLayer` uses when it takes the newest `seq` at mount so a
 * remount cannot replay effects the human already saw. Both cases that reach
 * here are real: a link restored before the component mounted, and a remount
 * (React StrictMode's double-mount is the common one) after the agent has been
 * working for a while.
 *
 * It takes the whole state rather than just `restoredAgentState` because the
 * remount case is a store fact too, and a boot that ignored `activity` would
 * replay the awakening on every remount.
 */
export function bootMode(state: AwakenState): AwakenMode {
  return isAgentState(state) ? "awake" : "idle";
}

export interface AwakenController {
  /** The current mode. Also delivered to `onMode` at every change. */
  mode(): AwakenMode;
  /**
   * The choreography has landed: "waking" → "awake". Idempotent, and safe to
   * call from the kill-switch and reduced-motion paths, which reach the end
   * state early. Ignored in any other mode — nothing may skip the story to its
   * end before it has started.
   */
  completeWaking(): void;
  /**
   * Unsubscribe and stop the ceiling timer. A teardown mid-story lands the
   * mode on "awake": the agent chrome is the transition's product, the store
   * still says an agent is here, and `body[data-awaken]` must be left in one
   * of the two resting states rather than frozen mid-flight.
   */
  teardown(): void;
}

/**
 * Whether the awakening has already played in this document.
 *
 * Module state rather than controller state, and deliberately: React unmounts
 * and remounts components, and a page that replayed the whole announcement
 * because a parent re-rendered would be lying about a second arrival. It is
 * the same reason `useShareHash` keeps its `applied` flag at module scope.
 */
let played = false;

/**
 * Forget that it played. For tests and the dev harness only — in a real
 * session the awakening is once per document, and there is no product path
 * that calls this.
 */
export function resetAwakenPlayed(): void {
  played = false;
}

export interface AwakenOptions {
  store: AwakenStore;
  /**
   * Called once with the boot mode, then at every change. The UI writes
   * `body[data-awaken]` here and, on "waking", starts the choreography.
   */
  onMode(mode: AwakenMode): void;
}

/**
 * Watch the store and answer the one question the chrome depends on: is an
 * agent arriving right now?
 *
 * It plays on exactly one event — the write that first puts this page into an
 * agent state, live. Everything else lands on the end state in silence:
 *
 *  - a restored link (`restoredAgentState` true on the write that crosses),
 *  - a page that was already in an agent state when this started watching,
 *  - a second crossing after the story has played once in this document.
 *
 * Whatever order mount, restore writes and the first live call arrive in, and
 * however they interleave, the result is the same — which is what the
 * ordering tests in `awaken.test.ts` enumerate.
 */
export function createAwaken({ store, onMode }: AwakenOptions): AwakenController {
  let mode: AwakenMode = bootMode(store.getState());
  let ceiling: ReturnType<typeof setTimeout> | null = null;

  const clearCeiling = () => {
    if (ceiling !== null) clearTimeout(ceiling);
    ceiling = null;
  };

  const go = (next: AwakenMode) => {
    if (next === mode) return;
    mode = next;
    onMode(mode);
  };

  const complete = () => {
    clearCeiling();
    go("awake");
  };

  // The crossing already happened where nobody was watching; nothing is left
  // to narrate, and nothing may narrate it later either.
  if (mode === "awake") played = true;
  onMode(mode);

  const unsubscribe = store.subscribe((state) => {
    // `mode` is this module's own memory of where the page is, and it is what
    // the crossing is judged against rather than the store's `previous`: a
    // controller that started in the middle of a write sequence was not there
    // for the writes before it, and must not read one of them as a transition
    // it missed.
    if (mode !== "idle" || !isAgentState(state)) return;
    // An agent worked before this link was sent. Real agent state, no arrival:
    // this is the write flag-first ordering puts at the head of the restore
    // sequence, and reading it as a crossing is exactly the bug that ordering
    // exists to make impossible.
    if (state.restoredAgentState) return go("awake");
    if (played) return go("awake");
    played = true;
    go("waking");
    // The ≤ 2 s law, enforced rather than trusted: if the choreography never
    // reports back, the page still finishes waking up.
    ceiling = setTimeout(complete, AWAKEN_MAX_MS);
  });

  return {
    mode: () => mode,
    completeWaking: () => {
      if (mode === "waking") complete();
    },
    teardown: () => {
      unsubscribe();
      clearCeiling();
      if (mode === "waking") go("awake");
    },
  };
}
