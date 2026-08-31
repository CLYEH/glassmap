import { create } from "zustand";
import { useMapStore } from "@/lib/store/map-store";
import type { Tier2Category } from "@/lib/store/tier2";

/**
 * Places browsing: the tier-2 categories a human asked to see painted.
 *
 * Deliberately *not* in `map-store.ts`, for the same reason the drawing draft
 * is not: browsing is a human looking around, not map state. No tool selected
 * anything and nothing was acted on. What crosses into the shared store is
 * only what the human then does — a selection.
 *
 * The guarantee that buys is about the tool surface, and only that: no tool
 * reads or writes this store, so an agent working through `modelContext`
 * cannot see which categories a person is scanning, and cannot steer them. It
 * is not a secret from the page — `MarkerStatus` mirrors the set into the
 * off-screen `browse-state` span, because beads are pixels on a WebGL canvas
 * and that span is the only thing a headless run can assert — so anything with
 * DOM access can read it. Keeping it out of the store keeps it out of the
 * tools.
 *
 * A category must already be loaded (`restoreTier2Categories`) before it can
 * be browsed; `browse()` does both, in that order, so the layer never paints a
 * category whose file has not arrived.
 *
 * MapCanvas subscribes to this imperatively (it must not re-render); the tray
 * that drives it reads it with the hook — the same split `draw-store` uses.
 */

/**
 * How many kinds of place may be painted at once.
 *
 * The ink is the reason, and it is a hard one: the budget is a single
 * allowance of twelve numerals over the whole painted set (see `threshold`),
 * so every category added divides the same twelve between more kinds of place.
 * At three the map still reads as three answers to "what is around here"; past
 * it the counted beads stop belonging to anything a person can name.
 *
 * The tier-2 study's round-5 clause lands on the same number from the adjacent
 * question — it caps how many large categories may be *loaded* at once on a
 * phone, not how many may be painted, and browsing here loads without ever
 * unloading — so it is corroboration for the figure rather than its authority.
 */
export const BROWSE_MAX = 3;

interface BrowseStore {
  /** The painted categories, oldest first. Empty is the calm map. */
  categories: Tier2Category[];
  /** The categories whose files are on their way, in tap order. */
  pending: Tier2Category[];
  /**
   * The `point_count` at which a cluster in view earns a numeral, republished
   * by the map on `idle` (the first moment after a pan at which the clusters
   * are stable). `Infinity` until the first budget pass, and whenever the ink
   * budget reaches nothing — see `countedClusterThreshold`.
   *
   * One number for the whole painted set, not one per category: the budget is
   * a claim about how much ink is on screen, and the screen does not have a
   * separate allowance per category. A per-category threshold would let three
   * categories draw thirty-six numerals over the same streets, which is the
   * exact failure K=12 exists to prevent.
   *
   * `setThreshold` is the only writer, and the map is its only caller. Nothing
   * here may reset it, however stale it looks: the map republishes only when
   * the number *changes* (setting the same filter repaints, which fires
   * `idle`, which lands back in the budget pass), so a reset the map cannot
   * see leaves the store saying "none counted" while the layer filter is still
   * counting at 27. That is the category-switch desync the T-81 review caught,
   * and adding and removing categories is now that switch several times over.
   */
  threshold: number;
  /**
   * Paint a category, loading its file first. Resolves with the category the
   * cap pushed off the map to make room, or null — nothing was evicted, the
   * file did not load, or the human took the pick back while it was in flight.
   *
   * The answer comes from here because only the write that evicted knows: a
   * caller comparing the set before and after its own `await` cannot tell the
   * cap's eviction from a category the person removed with its × meanwhile,
   * and would blame the cap for a chip they closed themselves.
   */
  browse: (category: Tier2Category) => Promise<Tier2Category | null>;
  /** Stop painting one category, leaving the others alone. */
  remove: (category: Tier2Category) => void;
  clear: () => void;
  setThreshold: (threshold: number) => void;
}

export const useBrowseStore = create<BrowseStore>((set, get) => ({
  categories: [],
  pending: [],
  threshold: Number.POSITIVE_INFINITY,
  browse: async (category) => {
    const { categories, pending } = get();
    if (categories.includes(category) || pending.includes(category)) return null;
    set({ pending: [...pending, category] });
    const result = await useMapStore.getState().restoreTier2Categories([category]);
    let evicted: Tier2Category | null = null;
    set((s) => {
      // Two reasons this category may still not be painted. A file that would
      // not load paints nothing: "no cafes here" and "the cafe file never
      // arrived" must never look the same. And a pick the human took back
      // while it was in flight is no longer pending — `clear`/`remove` drop it
      // — so it must not land on the map a second or two after they said no.
      const paint = result.ok && s.pending.includes(category);
      const pending = s.pending.filter((c) => c !== category);
      if (!paint) return { categories: s.categories, pending };
      // Oldest out, and only here: eviction is what makes the fourth tap an
      // answer rather than a refusal. Reported from inside this write because
      // this is the only place that can tell it apart from a category the
      // human closed by hand while the file was arriving.
      const next = [...s.categories, category];
      if (next.length > BROWSE_MAX) evicted = next[0];
      return { categories: next.slice(-BROWSE_MAX), pending };
    });
    return evicted;
  },
  remove: (category) =>
    set((s) => ({
      categories: s.categories.filter((c) => c !== category),
      pending: s.pending.filter((c) => c !== category),
    })),
  clear: () => set({ categories: [], pending: [] }),
  setThreshold: (threshold) => set({ threshold }),
}));
