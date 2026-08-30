import { create } from "zustand";
import type { CardTarget } from "./card-model";

export type { CardTarget };

/**
 * The "On the map" card: the answer a human's tap gets, whatever they tapped —
 * a place, a pinned note or a drawn shape.
 *
 * Deliberately *not* in `map-store.ts`, for the same reason the drawing draft
 * and the browse category are not (`draw-store.ts`, `browse-store.ts`): a card
 * hovering over a mark is a person looking, not map state. The tap's real
 * effect — the selection — is already in the shared store, where the tools can
 * see it; which of those marks currently has a card open is nobody else's
 * business, and an agent must not be able to read a pointer at what the human
 * is reading, let alone move it.
 *
 * MapCanvas writes it imperatively (it must never re-render), `OnTheMapCard`
 * reads it with the hook — the same split the other two UI stores use.
 */
interface CardStore {
  /** The open card, or null when nothing was tapped. */
  target: CardTarget | null;
  open: (target: CardTarget) => void;
  close: () => void;
  /**
   * Closes only when the open card is this mark's.
   *
   * Two callers, one gesture apart: the map's own toggle, and the selection
   * subscription that fires when *anything* — an agent's `select_features`, an
   * undo, a restored link — takes a place off the map while a human is reading
   * about it. Ids are unique across the three kinds (features carry OSM ids,
   * the store hands out `annotation:<n>` / `drawing:<n>` from counters that
   * never go backwards), so matching on the id alone cannot close the wrong
   * card.
   */
  closeFor: (id: string) => void;
}

export const useCardStore = create<CardStore>((set, get) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
  closeFor: (id) => {
    if (get().target?.id === id) set({ target: null });
  },
}));
