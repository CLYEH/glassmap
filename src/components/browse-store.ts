import { create } from "zustand";
import { useMapStore } from "@/lib/store/map-store";
import type { Tier2Category } from "@/lib/store/tier2";

/**
 * Places browsing: the one tier-2 category a human asked to see painted.
 *
 * Deliberately *not* in `map-store.ts`, for the same reason the drawing draft
 * is not: browsing is a human looking around, not map state. No tool selected
 * anything, nothing was acted on, and an agent that could read (or steer) what
 * a person is idly scanning would be reading over their shoulder. What crosses
 * into the shared store is only what the human then does — a selection.
 *
 * The category must already be loaded (`restoreTier2Categories`) before it can
 * be browsed; `browse()` does both, in that order, so the layer never paints a
 * category whose file has not arrived.
 *
 * MapCanvas subscribes to this imperatively (it must not re-render); the panel
 * that will drive it reads it with the hook — the same split `draw-store` uses.
 */
interface BrowseStore {
  /** The painted category, or null for the calm map. */
  category: Tier2Category | null;
  /** True while the category's file is on its way. */
  loading: boolean;
  /**
   * The `point_count` at which a cluster in view earns a numeral, republished
   * by the map on every `moveend`. `Infinity` until the first budget pass, and
   * whenever the ink budget reaches nothing — see `countedClusterThreshold`.
   */
  threshold: number;
  browse: (category: Tier2Category) => Promise<void>;
  clear: () => void;
  setThreshold: (threshold: number) => void;
}

export const useBrowseStore = create<BrowseStore>((set, get) => ({
  category: null,
  loading: false,
  threshold: Number.POSITIVE_INFINITY,
  browse: async (category) => {
    if (get().category === category) return;
    set({ loading: true });
    const result = await useMapStore.getState().restoreTier2Categories([category]);
    // A category that would not load paints nothing: "no cafes here" and "the
    // cafe file never arrived" must never look the same.
    if (!result.ok) {
      set({ loading: false });
      return;
    }
    set({ category, loading: false, threshold: Number.POSITIVE_INFINITY });
  },
  clear: () => set({ category: null, loading: false, threshold: Number.POSITIVE_INFINITY }),
  setThreshold: (threshold) => set({ threshold }),
}));
