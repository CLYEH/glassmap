import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * The live MapLibre map, published by `MapCanvas` for the FX layer to project
 * with.
 *
 * A module-level handle rather than React state on purpose: `MapCanvas` owns
 * the map imperatively and must never re-render (see its own comment), and the
 * FX driver reads the map inside a rAF frame, not inside a render. There is
 * exactly one map per page, so there is exactly one slot.
 *
 * `null` is a supported, frequent state — headless CI has no WebGL2 and the
 * map is never constructed. Map-space effects degrade to their feed-row glow;
 * viewport-space effects (viewfinder, scan band, share pack) are unaffected.
 */
let current: MapLibreMap | null = null;

export function setFxMap(map: MapLibreMap | null): void {
  current = map;
}

export function getFxMap(): MapLibreMap | null {
  return current;
}
