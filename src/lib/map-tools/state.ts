import type { MapView } from "@/lib/store/map-store";

/** Round to 5 decimals (~1 m) to keep tool output small. */
export const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Serialisable map state returned by get_map_state and every write tool. */
export interface MapStateOutput {
  center: { lng: number; lat: number };
  zoom: number;
  bearing: number;
  pitch: number;
}

export function describeView(view: MapView): MapStateOutput {
  return {
    center: { lng: round5(view.center[0]), lat: round5(view.center[1]) },
    zoom: round5(view.zoom),
    bearing: round5(view.bearing),
    pitch: round5(view.pitch),
  };
}
