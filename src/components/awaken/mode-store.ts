import { create } from "zustand";
import type { AwakenMode } from "@/lib/awaken";

/**
 * Which chrome the page is wearing right now, as React sees it.
 *
 * The mode is *not* a selector over the map store any more, and that is the
 * whole of T-83 in one sentence: between "no agent has acted" and "an agent is
 * here" there is now a third state, `waking`, which no store fact can compute —
 * it is the 1800 ms the transition takes. The awakening controller
 * (`src/lib/awaken/`) is the only writer; every component reads it through
 * `useAwakenMode`.
 *
 * A store of its own rather than a field on `map-store.ts`, for the same reason
 * the card, the draw draft and the browse category are their own stores: an
 * agent must not be able to read — or worse, write — which frame of an
 * animation the human is looking at. The map store is the tools' surface, and
 * nothing about this belongs on it.
 *
 * Its initial value is `idle` and must stay that way: the server renders the
 * human chrome, so a client store that started anywhere else would hydrate into
 * a mismatch. A restored agent link is dressed before hydration by the inline
 * script (`app/boot-chrome.ts`) and confirmed here a moment later, when the
 * controller reports its boot mode.
 */
interface AwakenModeStore {
  mode: AwakenMode;
  setMode: (mode: AwakenMode) => void;
}

export const useAwakenStore = create<AwakenModeStore>((set) => ({
  mode: "idle",
  setMode: (mode) => set({ mode }),
}));
