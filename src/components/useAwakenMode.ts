"use client";

import type { AwakenMode } from "@/lib/awaken";
import { useAwakenStore } from "./awaken/mode-store";

/**
 * Which chrome the page is wearing: the human-first map, the transition, or the
 * agent's.
 *
 * One selector, read by everything that has something to hide or to show — the
 * feed, the badge, the inspector lane, the whisper, the landing hint — so "is
 * an agent here" is answered in exactly one place.
 *
 * **The answer no longer comes from the map store.** It used to be
 * `bootMode(state)`: the store said an agent had acted, and the chrome flipped
 * in the same commit. That is now the *boot* answer only. The live answer comes
 * from the awakening controller (`src/lib/awaken/`, mounted once by `page.tsx`
 * through `awaken/controller.ts`), because between the two states there is a
 * third — `waking`, the 1800 ms in which the agent chrome arrives — and no
 * store fact can compute a frame of an animation.
 *
 * Read it as three answers to two questions:
 *
 *  - `mode !== "idle"` — is the agent chrome on screen at all? The panels mount
 *    on `waking` (the story needs something to move) and stay for `awake`.
 *  - `mode !== "awake"` — are the human-only surfaces still there? The corner
 *    spark and the landing hint live through the transition, because the
 *    transition is *made of* them leaving.
 */
export function useAwakenMode(): AwakenMode {
  return useAwakenStore((s) => s.mode);
}
