import { create } from "zustand";
import type { LngLat } from "@/lib/store/map-store";

/**
 * ~1 m, rounded on the way in exactly as `draw-store.ts` rounds a corner: the
 * place the provisional pin is drawn at, the place the form says it will pin
 * to and the place the annotation ends up at are then the same number.
 */
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * Where the note a person is typing is going to land, deliberately *not* in
 * `map-store.ts` — the same line `draw-store.ts` draws. An unfinished note is
 * UI: it has no id, it is on no map, and no tool may see or steer it. Only the
 * finished note crosses over, through `addAnnotation`.
 *
 * `open` lives here too, rather than in `Tools`'s own state, because MapCanvas
 * has to know whether the next click on the map is a place for this note.
 * MapCanvas subscribes imperatively (it must not re-render), the form and the
 * toggle read it with the hook — the same split hand-drawing uses.
 *
 * The draft never survives the popover: opening or closing it starts a note
 * with no place, which is the state the form calls "centre".
 */
interface NoteStore {
  /** Whether the note popover is open — the toggle's own state (`Tools`). */
  open: boolean;
  /** Where the next note goes, or null for "wherever the map centre is". */
  draft: LngLat | null;
  setOpen: (open: boolean) => void;
  /** A click on the map while the popover is open: place the pin, or move it. */
  place: (at: LngLat) => void;
  clearDraft: () => void;
}

export const useNoteStore = create<NoteStore>((set) => ({
  open: false,
  draft: null,
  setOpen: (open) => set({ open, draft: null }),
  place: ([lng, lat]) => set({ draft: [round5(lng), round5(lat)] }),
  clearDraft: () => set({ draft: null }),
}));
