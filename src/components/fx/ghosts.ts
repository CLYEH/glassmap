/**
 * What a mark looked like at the moment it left the map.
 *
 * The human's ✕ can carry the geometry in its own event (`human-events.ts`)
 * because the code that deletes and the code that announces are the same
 * gesture. `remove_from_map` cannot: its feed row is written after the tool has
 * already returned, so when the FX layer reads the store to plan the dissolve,
 * the shape it has to dissolve is not there any more. Without this memory the
 * one effect whose whole subject is a *disappearance* would be the only tool
 * call on the page that never draws anything.
 *
 * So the outlines are taken one store write earlier, from the transition that
 * removed them: zustand hands the listener the previous state, and every mark
 * in it that is not in the next one is remembered. Deliberately a diff of
 * removals only — `human-events.ts` explains why a diff of *additions* would be
 * a lie (a share link appends every shape it carried, one write at a time, and
 * a diff would replay them as if someone had just drawn them). Nothing here
 * triggers an effect; it only answers "where was it" when a removal's own feed
 * row asks.
 */
import type { Annotation, Drawing, LngLat } from "@/lib/store/map-store";
import { outlineOf, type FxOutline } from "./plan";

/** The two arrays this watches. `MapState` satisfies it structurally. */
export interface MarkState {
  drawings: readonly Drawing[];
  annotations: readonly Annotation[];
}

/**
 * How many departed marks are kept. A removal is planned on the very next store
 * write, so one batch (the tool's own cap of 20) would do; twice that leaves
 * room for a second call landing between the two, and bounds a long session's
 * memory at a few hundred bytes. This is a buffer, not a history.
 */
export const GHOST_LIMIT = 40;

export interface GhostMemory {
  /** Remembers every mark present in `before` and gone from `after`. */
  observe(before: MarkState, after: MarkState): void;
  /** The outline that mark had when it left, or null. */
  recall(id: string): FxOutline | null;
}

export function createGhostMemory(limit: number = GHOST_LIMIT): GhostMemory {
  // Insertion-ordered, so "drop the oldest" is the first key.
  const ghosts = new Map<string, FxOutline>();

  const keep = (id: string, outline: FxOutline | null) => {
    if (!outline) return;
    ghosts.set(id, outline);
    if (ghosts.size <= limit) return;
    const oldest = ghosts.keys().next();
    if (!oldest.done) ghosts.delete(oldest.value);
  };

  return {
    observe(before, after) {
      // Identity first: every store write reaches this, and all but the few
      // that touch a mark leave both arrays alone.
      if (before.drawings !== after.drawings) {
        const live = new Set(after.drawings.map((d) => d.id));
        for (const drawing of before.drawings) {
          if (!live.has(drawing.id)) keep(drawing.id, outlineOf(drawing));
        }
      }
      if (before.annotations !== after.annotations) {
        const live = new Set(after.annotations.map((a) => a.id));
        for (const annotation of before.annotations) {
          if (live.has(annotation.id)) continue;
          const at: LngLat = [annotation.at[0], annotation.at[1]];
          keep(annotation.id, { positions: [at], closed: false });
        }
      }
    },

    recall: (id) => ghosts.get(id) ?? null,
  };
}
