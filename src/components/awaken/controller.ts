"use client";

import { useEffect } from "react";
import { createAwaken, resetAwakenPlayed, type AwakenController, type AwakenMode } from "@/lib/awaken";
import { useMapStore } from "@/lib/store/map-store";
import { useAwakenStore } from "./mode-store";

/**
 * The one awakening controller this document is allowed to have, and the two
 * attributes it publishes.
 *
 * `src/lib/awaken/` is store-only by design — it never sees the DOM, which is
 * what lets its eleven ordering cases be asserted in node. This is the other
 * half: it mounts exactly one controller (the module's own hard requirement —
 * two live controllers share one `played` flag, and the loser would report the
 * end state with no transition, i.e. a page that announced the agent in the
 * badge and not in the lane), and it writes what the controller decides onto
 * the document.
 *
 * **Two attributes, because they answer different questions.**
 *
 *  - `html[data-chrome]` is what the *stylesheet* reads: `idle` (human chrome),
 *    `waking` (agent surfaces mounted but transparent, human positions kept —
 *    the choreography drives them from there) and `awake`. It is on the root
 *    element because the inline boot script writes it before the first paint on
 *    a restored link (`app/boot-chrome.ts`), and one attribute with two writers
 *    in sequence beats two attributes that can disagree.
 *  - `body[data-awaken]` is the *lifecycle* contract the design names
 *    (design2-v5, `mockup2-v5.html`:53, and `src/lib/awaken/index.ts`'s own
 *    doc): e2e waits on `awake`, not on a frame. Same three values, and it is
 *    written on `body` — where the module says it goes — precisely so that a
 *    test can tell "the transition has finished" from "the stylesheet is
 *    dressed for the agent", which reduced motion makes different questions
 *    (final positions, `awake`; crossfade still running, `waking`).
 *
 * `onMode` can fire synchronously from `teardown()`, which in React is the
 * cleanup pass, so everything here has to be safe to run while the tree is
 * coming down: two attribute writes and one store set, no measurement, no
 * animation, nothing that reads a node that may already be gone.
 */

let controller: AwakenController | null = null;

/**
 * A frame the dev harness asked to be held. Module state because it has to
 * survive the render that mounts the chrome the frame is *of* — the stage
 * effect picks it up on the commit where the panels exist.
 */
let pendingFreeze: number | null = null;

/** Publish the mode: the store React reads, and the two document attributes. */
function applyMode(mode: AwakenMode): void {
  useAwakenStore.getState().setMode(mode);
  writeChrome(mode);
  if (document.body.dataset.awaken !== mode) document.body.dataset.awaken = mode;
}

function writeChrome(mode: AwakenMode): void {
  const root = document.documentElement;
  // Guarded: this runs on every mode change and the attribute is a style
  // invalidation on the root element.
  if (root.dataset.chrome !== mode) root.dataset.chrome = mode;
}

/**
 * Mount the controller. Called once, from `page.tsx`, and deliberately from
 * the *page* rather than from `AwakenStage`: React runs child effects before
 * parent ones, so a controller mounted in a child would boot before
 * `ShareStatus` has applied the URL fragment and would write `idle` over the
 * boot script's `awake` — the exact flash that script exists to prevent. Here
 * it reads a store that has already settled.
 */
export function useAwakenController(): void {
  useEffect(() => {
    const instance = createAwaken({ store: useMapStore, onMode: applyMode });
    controller = instance;
    return () => {
      instance.teardown();
      if (controller === instance) controller = null;
    };
  }, []);
}

/**
 * The choreography has landed. Idempotent, and it does two things rather than
 * one: `completeWaking()` is how the *module* learns the story is over (it
 * cancels the 2 s ceiling that would otherwise complete it for us), and
 * `applyMode` covers the dev harness's replay, where the controller is already
 * awake and would answer that call with silence.
 */
export function landAwake(): void {
  controller?.completeWaking();
  applyMode("awake");
}

/**
 * Put the chrome in its final positions without ending the transition — the
 * reduced-motion path only. A dump read mid-crossfade therefore says
 * `data-chrome="awake"` with `data-awaken="waking"`, which is correct and not
 * a bug: reduced motion removes the travel, so there is nothing left for the
 * transition to do but opacity.
 */
export function finalPositions(): void {
  writeChrome("awake");
}

/** The frame the harness asked for, consumed once. */
export function takePendingFreeze(): number | null {
  const value = pendingFreeze;
  pendingFreeze = null;
  return value;
}

/**
 * Restage the transition from the beginning: back to the human chrome for a
 * commit, then into `waking` again.
 *
 * Two commits, awaited, because the story is painted onto panels React mounts —
 * the feed, the lane, the ticker exist only from the commit that says
 * "waking", and a frozen frame taken before that would be a still of an empty
 * map. Dev and QA only; there is no product path that replays an arrival.
 */
async function restage(): Promise<void> {
  applyMode("idle");
  // The marker is what `settled` waits for, so a stale one from the previous
  // freeze would let the next call return before its own frame was painted.
  delete document.querySelector<HTMLElement>('[data-testid="awaken-stage"]')?.dataset.awakenP;
  await nextFrame();
  applyMode("waking");
  await settled();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/** Waits for the commit that mounts the agent chrome, then one frame to paint. */
async function settled(): Promise<void> {
  for (let tries = 0; tries < 30; tries += 1) {
    const staged = document.querySelector(
      '[data-testid="activity-feed"], [data-testid="activity-ticker"]',
    );
    const stage = document.querySelector<HTMLElement>('[data-testid="awaken-stage"]');
    if (staged && stage?.dataset.awakenP !== undefined) return;
    await nextFrame();
  }
}

export interface AwakenDevHandle {
  /** Hold the story at `p` (0..1) and leave it there, for a still. */
  freeze(p: number): Promise<void>;
  /** Play the whole thing again from the top. */
  replay(): Promise<void>;
}

export const awakenDevHandle: AwakenDevHandle = {
  freeze: async (p) => {
    pendingFreeze = p;
    await restage();
  },
  replay: async () => {
    pendingFreeze = null;
    // The module refuses a second arrival on purpose (`played` is per
    // document); the harness is the one caller allowed to forget.
    resetAwakenPlayed();
    await restage();
  },
};
