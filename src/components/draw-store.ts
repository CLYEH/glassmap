import { create } from "zustand";
import { useMapStore, type Drawing, type LngLat } from "@/lib/store/map-store";
import { polygonFromVertices } from "./drawing-style";

export type DrawMode = "none" | "polygon";

/**
 * Hand-drawing state, deliberately *not* in `map-store.ts`: an unfinished
 * draft is UI, not map state, and no tool should be able to see or steer it.
 * Only the finished shape crosses over, through `addDrawing`.
 *
 * MapCanvas subscribes to this imperatively (it must not re-render), the
 * toolbar reads it with the hook - the same split the map/store sync uses.
 */
interface DrawStore {
  mode: DrawMode;
  /** Vertices clicked so far, in order. Empty unless mode is "polygon". */
  draft: LngLat[];
  start: () => void;
  cancel: () => void;
  addVertex: (vertex: LngLat) => void;
  /** Stores the draft as a user drawing; null (and no state change) if it has fewer than three corners. */
  finish: () => Drawing | null;
}

export const useDrawStore = create<DrawStore>((set, get) => ({
  mode: "none",
  draft: [],
  start: () => set({ mode: "polygon", draft: [] }),
  cancel: () => set({ mode: "none", draft: [] }),
  addVertex: (vertex) => set((s) => ({ draft: [...s.draft, vertex] })),
  finish: () => {
    const geometry = polygonFromVertices(get().draft);
    if (!geometry) return null;
    const drawing = useMapStore
      .getState()
      .addDrawing({ source: "user", kind: "polygon", geometry });
    set({ mode: "none", draft: [] });
    return drawing;
  },
}));
