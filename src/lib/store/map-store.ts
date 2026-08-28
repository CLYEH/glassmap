import { create } from "zustand";

/** [lng, lat] */
export type LngLat = [number, number];

export interface MapView {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

/** Taipei Main Station area. */
export const DEFAULT_VIEW: MapView = {
  center: [121.5175, 25.0478],
  zoom: 12,
  bearing: 0,
  pitch: 0,
};

/**
 * The narrow interface tools use to read/write map state.
 * Tools never import React or MapLibre; tests pass an in-memory adapter.
 */
export interface MapToolStore {
  getView(): MapView;
  setView(patch: Partial<MapView>): void;
}

/** Which WebMCP surfaces picked up our tools; null until registration ran. */
export interface WebMcpInfo {
  surfaces: string[];
  toolCount: number;
}

interface MapStore {
  view: MapView;
  setView: (patch: Partial<MapView>) => void;
  webmcp: WebMcpInfo | null;
  setWebMcp: (info: WebMcpInfo | null) => void;
}

export const useMapStore = create<MapStore>((set) => ({
  view: DEFAULT_VIEW,
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  webmcp: null,
  setWebMcp: (webmcp) => set({ webmcp }),
}));

/** Adapter over the Zustand store for the tool layer. */
export const zustandToolStore: MapToolStore = {
  getView: () => useMapStore.getState().view,
  setView: (patch) => useMapStore.getState().setView(patch),
};

/** In-memory adapter for unit tests. */
export function createMemoryToolStore(initial: MapView = DEFAULT_VIEW): MapToolStore {
  let view = { ...initial };
  return {
    getView: () => view,
    setView: (patch) => {
      view = { ...view, ...patch };
    },
  };
}
