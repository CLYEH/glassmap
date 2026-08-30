"use client";

import { useEffect } from "react";
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

/**
 * Publish the mode on the root element, where the stylesheet reads it.
 *
 * It lives on `<html>` rather than on the page's own `<main>` because the first
 * writer is not React: an inline script decides the chrome from the URL
 * fragment before anything is painted (`app/boot-chrome.ts`), and React cannot
 * render an attribute it will only know the value of an effect later. One
 * attribute, two writers in sequence — the script until hydration, this from
 * hydration onwards — rather than two attributes that can disagree about what
 * the page is.
 *
 * Subscribed to the store rather than driven by the render's `mode`, and that
 * is the load-bearing part. This effect runs *after* the child effect that
 * applies a share link (React runs children first), so on a restored agent link
 * the store already says "awake" while this component's render still says
 * "idle" — writing the rendered value would undo the boot script's answer for
 * one frame, which is the exact flash the script exists to prevent. Reading the
 * store at effect time gets the settled answer, and the same subscription
 * carries every later crossing, when the first tool call arrives.
 *
 * It is also the correction path for a probe that guessed wrong: a fragment the
 * codec refuses leaves the store idle, and this writes "idle" over the script's
 * "awake" on the first commit after hydration.
 */
export function useChromeAttribute(): void {
  useEffect(() => {
    const write = () => {
      const mode = selectAwakenMode(useMapStore.getState());
      // Guarded: this runs on every store write there is, and the attribute is
      // a style invalidation on the root element.
      if (document.documentElement.dataset.chrome !== mode) {
        document.documentElement.dataset.chrome = mode;
      }
    };
    write();
    return useMapStore.subscribe(write);
  }, []);
}
