"use client";

import { bootMode, type AwakenMode, type AwakenState } from "@/lib/awaken";
import { useMapStore } from "@/lib/store/map-store";

/**
 * Which chrome the page is wearing: the human-first map, or the agent's.
 *
 * One selector, read by every component that has something to hide — the feed,
 * the badge, the inspector lane, the whisper — so "is an agent here" is
 * answered in exactly one place, and answered by `src/lib/awaken/`'s own
 * `bootMode` rather than by a second definition that could drift from the
 * module the trigger is built on. The store slice it needs (`activity`,
 * `restoredAgentState`) is the slice `AwakenState` names, so the compiler
 * checks the two stay the same question.
 *
 * **This is the placeholder half of the awakening.** The mode flips from
 * "idle" to "awake" on the store write itself, with no story in between: the
 * choreography, the "waking" mode and `body[data-awaken]` arrive with the
 * controller in T-83, which mounts `createAwaken` once beside `FxLayer` and
 * drives the same three values. Until then the page still crosses at exactly
 * the right moment — it just crosses instantly.
 *
 * Safe as a zustand selector because it returns a string: a fresh object per
 * read would re-render every subscriber on every store write.
 */
export function useAwakenMode(): AwakenMode {
  return useMapStore(selectAwakenMode);
}

/** The same answer for code that holds the state rather than the hook. */
export function selectAwakenMode(state: AwakenState): AwakenMode {
  return bootMode(state);
}
