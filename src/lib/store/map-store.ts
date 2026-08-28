import { create } from "zustand";
import type { GlassMapFeature } from "@/lib/data/schema";

/** [lng, lat] */
export type LngLat = [number, number];

/** [west, south, east, north] */
export type Bounds = [number, number, number, number];

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
 *
 * Ownership of each field:
 *  - view: written by tools (set_map_view) and by the map (user pans/zooms)
 *  - bounds: written by the map only, after every move; null until the map has rendered
 *  - features: written by the data loader once; read by tools and the map
 *  - selection: written by tools (select_features) and by the UI (click)
 */
export interface MapToolStore {
  getView(): MapView;
  setView(patch: Partial<MapView>): void;
  getBounds(): Bounds | null;
  getFeatures(): readonly GlassMapFeature[];
  getSelection(): readonly string[];
  setSelection(ids: string[]): void;
}

/** Which WebMCP surfaces picked up our tools; null until registration ran. */
export interface WebMcpInfo {
  surfaces: string[];
  toolCount: number;
}

interface MapStore {
  view: MapView;
  setView: (patch: Partial<MapView>) => void;
  bounds: Bounds | null;
  setBounds: (bounds: Bounds | null) => void;
  features: GlassMapFeature[];
  setFeatures: (features: GlassMapFeature[]) => void;
  selection: string[];
  setSelection: (ids: string[]) => void;
  webmcp: WebMcpInfo | null;
  setWebMcp: (info: WebMcpInfo | null) => void;
}

export const useMapStore = create<MapStore>((set) => ({
  view: DEFAULT_VIEW,
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  bounds: null,
  setBounds: (bounds) => set({ bounds }),
  features: [],
  setFeatures: (features) => set({ features }),
  selection: [],
  setSelection: (selection) => set({ selection }),
  webmcp: null,
  setWebMcp: (webmcp) => set({ webmcp }),
}));

/** Adapter over the Zustand store for the tool layer. */
export const zustandToolStore: MapToolStore = {
  getView: () => useMapStore.getState().view,
  setView: (patch) => useMapStore.getState().setView(patch),
  getBounds: () => useMapStore.getState().bounds,
  getFeatures: () => useMapStore.getState().features,
  getSelection: () => useMapStore.getState().selection,
  setSelection: (ids) => useMapStore.getState().setSelection(ids),
};

export interface MemoryToolStoreInit {
  view?: MapView;
  bounds?: Bounds | null;
  features?: GlassMapFeature[];
  selection?: string[];
}

/** In-memory adapter for unit tests. */
export function createMemoryToolStore(init: MemoryToolStoreInit = {}): MapToolStore {
  let view = { ...(init.view ?? DEFAULT_VIEW) };
  const bounds = init.bounds ?? null;
  const features = init.features ?? [];
  let selection = [...(init.selection ?? [])];
  return {
    getView: () => view,
    setView: (patch) => {
      view = { ...view, ...patch };
    },
    getBounds: () => bounds,
    getFeatures: () => features,
    getSelection: () => selection,
    setSelection: (ids) => {
      selection = [...ids];
    },
  };
}
