import { create } from "zustand";
import { useMapStore } from "@/lib/store/map-store";
import type { Tier2Category } from "@/lib/store/tier2";

/**
 * Places browsing: the one tier-2 category a human asked to see painted.
 *
 * Deliberately *not* in `map-store.ts`, for the same reason the drawing draft
 * is not: browsing is a human looking around, not map state. No tool selected
 * anything and nothing was acted on. What crosses into the shared store is
 * only what the human then does — a selection.
 *
 * The guarantee that buys is about the tool surface, and only that: no tool
 * reads or writes this store, so an agent working through `modelContext`
 * cannot see which category a person is scanning, and cannot steer it. It is
 * not a secret from the page — `MarkerStatus` mirrors it into the off-screen
 * `browse-state` span, because beads are pixels on a WebGL canvas and that
 * span is the only thing a headless run can assert — so anything with DOM
 * access can read it. Keeping it out of the store keeps it out of the tools.
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
   * by the map on `idle` (the first moment after a pan at which the clusters
   * are stable). `Infinity` until the first budget pass, and whenever the ink
   * budget reaches nothing — see `countedClusterThreshold`.
   *
   * `setThreshold` is the only writer, and the map is its only caller. Nothing
   * here may reset it, however stale it looks: the map republishes only when
   * the number *changes* (setting the same filter repaints, which fires
   * `idle`, which lands back in the budget pass), so a reset the map cannot
   * see leaves the store saying "none counted" while the layer filter is still
   * counting at 27. That is the category-switch desync the T-81 review caught.
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
    set({ category, loading: false });
  },
  clear: () => set({ category: null, loading: false }),
  setThreshold: (threshold) => set({ threshold }),
}));
