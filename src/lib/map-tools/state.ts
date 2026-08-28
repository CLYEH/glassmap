import type { Bounds, MapToolStore, MapView } from "@/lib/store/map-store";

/** Round to 5 decimals (~1 m) to keep tool output small. */
export const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** How many selected ids describeState lists; the count is always exact. */
export const SELECTION_ID_LIMIT = 20;

/** Camera only — also rendered by the page, so it must stay stable. */
export interface ViewOutput {
  center: { lng: number; lat: number };
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface BoundsOutput {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Serialisable map state returned by get_map_state and every write tool. */
export interface MapStateOutput extends ViewOutput {
  /** Visible extent; null until the map has rendered once. */
  bounds: BoundsOutput | null;
  selection: { count: number; ids: string[] };
  features_loaded: number;
}

export function describeView(view: MapView): ViewOutput {
  return {
    center: { lng: round5(view.center[0]), lat: round5(view.center[1]) },
    zoom: round5(view.zoom),
    bearing: round5(view.bearing),
    pitch: round5(view.pitch),
  };
}

export function describeBounds(bounds: Bounds | null): BoundsOutput | null {
  if (!bounds) return null;
  return {
    west: round5(bounds[0]),
    south: round5(bounds[1]),
    east: round5(bounds[2]),
    north: round5(bounds[3]),
  };
}

/**
 * The one state object the agent ever needs: what the camera shows, what is
 * highlighted and how much data is loaded. Every write tool returns it so no
 * follow-up read is required.
 */
export function describeState(store: MapToolStore): MapStateOutput {
  const selection = store.getSelection();
  return {
    ...describeView(store.getView()),
    bounds: describeBounds(store.getBounds()),
    selection: { count: selection.length, ids: selection.slice(0, SELECTION_ID_LIMIT) },
    features_loaded: store.getFeatures().length,
  };
}
