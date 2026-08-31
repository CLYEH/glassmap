import { create } from "zustand";
import type { AwakenMode } from "@/lib/awaken";
import { feedIsLive } from "./activity-model";
import { useAwakenStore } from "./awaken/mode-store";

/**
 * The human's own say in which chrome is on screen — the manual override the
 * awakening machine knows nothing about (T-93, `docs/design/`).
 *
 * Until now the agent chrome could only *arrive*, and only a WebMCP call could
 * bring it: a visitor could not look at what an agent sees without asking an
 * agent to act, and once the chrome was up there was no way back to the map.
 * This store is both directions, and it is deliberately a *second* fact rather
 * than a fourth mode:
 *
 *  - `null` — follow the machine. The default, and what the page returns to.
 *  - `"open"` — show the agent chrome even though no agent has acted.
 *  - `"closed"` — hide it even though one has.
 *
 * **The machine is untouched.** `src/lib/awaken/` still owns `idle → waking →
 * awake`, its `played` flag is still spent exactly once per document, and the
 * controller still writes `data-chrome`/`data-awaken` alone. Nothing here can
 * enter, skip or replay the story; rendering is the *composition* of the two
 * facts (`chromeVisible`), which is why a manual open cannot eat the 1.8 s
 * Awakening and a manual close cannot be undone by the agent's next call.
 *
 * **Module-scoped, like `played`.** A hand-closed chrome that a parent
 * re-render or React's StrictMode double-mount could resurrect would reopen
 * itself in front of somebody who had just closed it — the same reason
 * `lib/awaken`'s `played` and `useShareHash`'s `applied` live outside React.
 *
 * **No tool may read or write it**, the same law the card, the draw draft and
 * the browse category live under (`card-store.ts`, `browse-store.ts`): whether
 * a person is currently looking at the agent's view of the map is not map
 * state, and an agent that could close its own audit trail is not one worth
 * watching.
 *
 * **It does not survive a reload**, and that is a choice rather than an
 * omission (design §"Honesty rulings"): persisting a close would let one tap
 * permanently disarm the demo on a judge's machine, and would make
 * `awakening.spec.ts`'s reload assertions depend on storage state.
 */
export type ChromePanel = null | "open" | "closed";

/**
 * Is the agent chrome on screen — the one fact the lane, the panels and the
 * stylesheet all answer to.
 *
 * The precedence is the whole design in three lines: a hand says what a hand
 * says, and only in its absence does the machine decide. `waking` counts as
 * visible because the panels mount for the story (the transition needs
 * something to move); the panel is always `null` by then — `followMachine()`
 * below runs the instant `waking` begins — so the two never argue over a frame
 * of the choreography.
 */
export function chromeVisible(mode: AwakenMode, panel: ChromePanel): boolean {
  if (panel === "closed") return false;
  if (panel === "open") return true;
  return mode !== "idle";
}

/**
 * How many tool calls have landed since the chrome was closed by hand.
 *
 * `activitySeq` and not the feed's row count, for two reasons that are both
 * lies waiting to happen: the feed keeps the newest `ACTIVITY_LIMIT` (50) rows
 * and drops the rest, and it folds runs of consecutive reads into one row
 * (`activity-model.ts`). The sequence counter is incremented once per
 * `recordActivity` and never rewound, so the delta is the exact number of
 * calls a person did not see — which is the only number the collapsed control
 * is allowed to print.
 */
export function unseenCalls(activitySeq: number, seqAtClose: number | null): number {
  if (seqAtClose === null) return 0;
  return Math.max(activitySeq - seqAtClose, 0);
}

/**
 * Is the collapsed spark standing in for something — the one fact its pulsing
 * ring, its "an agent has acted" copy and its count chip are all allowed to
 * claim.
 *
 * Two conditions, and the second one is `feedIsLive`, deliberately: the ring on
 * the spark IS the feed's ring, on the button the feed folded into, so it obeys
 * the feed's rule (`activity-model.ts`, design §"Honesty rulings": live
 * requires a call). Gating it on the machine instead — `mode === "awake"` —
 * animated it over zero calls on the one page that can be awake without any: a
 * restored share link boots `awake` from the hash, and closing that chrome by
 * hand produced a live ring beside a count chip that correctly refused to
 * render, while the feed on the same page held still. One rule, one animation,
 * and the restored case falls out of it rather than being special-cased.
 */
export function sparkIsWaiting(panel: ChromePanel, calls: number): boolean {
  return panel === "closed" && feedIsLive(calls);
}

interface PanelStore {
  panel: ChromePanel;
  /**
   * The store's `activitySeq` at the moment of the close, or `null` whenever
   * the chrome is not closed by hand. It is the zero point the unseen count is
   * measured from, so it is cleared by every exit from `"closed"`.
   */
  seqAtClose: number | null;
  /** Show the agent chrome by hand. Never enters the machine, never plays. */
  open: () => void;
  /**
   * Hide it by hand, remembering where the agent's log had got to.
   * `seq` is the caller's `useMapStore.getState().activitySeq`; passing it in
   * rather than reaching for the map store keeps this store testable on its
   * own and keeps the one-directional dependency (UI reads tools, never the
   * reverse) intact.
   */
  close: (seq: number) => void;
  /** Hand the question back to the machine. */
  followMachine: () => void;
}

export const usePanelStore = create<PanelStore>((set) => ({
  panel: null,
  seqAtClose: null,
  open: () => set({ panel: "open", seqAtClose: null }),
  close: (seq) => set({ panel: "closed", seqAtClose: seq }),
  followMachine: () => set({ panel: null, seqAtClose: null }),
}));

/**
 * The moment the story begins, the hand lets go.
 *
 * A visitor who opened the chrome to look at it, and *then* pointed an agent at
 * the page, must still get the Awakening — and the choreography measures the
 * human chrome it is about to displace (`awaken/choreography.ts` reads the
 * spark, the hint and the tools where the human rules put them). Left on
 * `"open"`, the panel would hand it the agent positions as a starting point and
 * the story would animate from its own destination.
 *
 * Subscribed here rather than in an effect on purpose: `applyMode` writes the
 * mode synchronously from the awakening controller, so this lands *before* the
 * commit that mounts the stage — React runs child effects before parent ones,
 * and a reset in `page.tsx` would arrive after `AwakenStage` had already
 * measured. The machine is not modified to do this; it does not know this store
 * exists.
 */
useAwakenStore.subscribe((state, previous) => {
  if (state.mode === "waking" && previous.mode !== "waking") {
    usePanelStore.getState().followMachine();
  }
});

/**
 * `html[data-panel]`, the override's own attribute — and never `data-chrome`,
 * which the boot script and the awakening controller own between them. Two
 * writers on one attribute would fight over every frame of the transition; two
 * attributes cannot, and the stylesheet composes them into the one predicate it
 * actually needs (see the "chrome gating" block in `globals.css`).
 *
 * Absent rather than `"none"` when the machine is in charge, so the CSS reads
 * an override as the exception it is — and so a document whose script never ran
 * is indistinguishable from one that never touched the toggle.
 */
function writePanel(panel: ChromePanel): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (panel === null) delete root.dataset.panel;
  else if (root.dataset.panel !== panel) root.dataset.panel = panel;
}

usePanelStore.subscribe((state, previous) => {
  if (state.panel !== previous.panel) writePanel(state.panel);
});

/** The chrome fact, read once, for the imperative half of the app (MapCanvas). */
export function readChromeVisible(): boolean {
  return chromeVisible(useAwakenStore.getState().mode, usePanelStore.getState().panel);
}

/**
 * Call `onChange` whenever the agent chrome comes or goes, from either cause.
 *
 * The corridor depends on this and nothing else: `MapCanvas` must re-pad the
 * camera and republish `bounds` when the lane appears or disappears, and a
 * manual flip makes none of the store transitions its subscriptions used to
 * watch (there is no new activity, no new mode, nothing in `map-store` at all).
 * Watching the derived answer rather than either input is also what keeps the
 * no-op cases silent — `idle → waking` with the panel already open does not
 * move the lane, so it must not move `bounds` either.
 */
export function subscribeChromeVisible(onChange: () => void): () => void {
  let last = readChromeVisible();
  const check = () => {
    const next = readChromeVisible();
    if (next === last) return;
    last = next;
    onChange();
  };
  const unsubscribeMode = useAwakenStore.subscribe(check);
  const unsubscribePanel = usePanelStore.subscribe(check);
  return () => {
    unsubscribeMode();
    unsubscribePanel();
  };
}
