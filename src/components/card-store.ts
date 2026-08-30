import { create } from "zustand";

/** Where the card points, in the map container's own pixel coordinates. */
export interface CardTarget {
  /** The feature the human tapped. Its provenance is read from the map store. */
  id: string;
  x: number;
  y: number;
}

/**
 * The "On the map" card: the answer a human's tap gets.
 *
 * Deliberately *not* in `map-store.ts`, for the same reason the drawing draft
 * and the browse category are not (`draw-store.ts`, `browse-store.ts`): a card
 * hovering over a place is a person looking, not map state. The tap's real
 * effect — the selection — is already in the shared store, where the tools can
 * see it; which of those selected places currently has a card open is nobody
 * else's business, and an agent must not be able to read a pointer at what the
 * human is reading, let alone move it.
 *
 * MapCanvas writes it imperatively (it must never re-render), `OnTheMapCard`
 * reads it with the hook — the same split the other two UI stores use.
 */
interface CardStore {
  /** The open card, or null when nothing was tapped. */
  target: CardTarget | null;
  open: (target: CardTarget) => void;
  close: () => void;
  /** Closes only when the open card is this feature's; used by the map's own toggle. */
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
