import type { Bounds } from "@/lib/store/map-store";

/**
 * The viewport maths, where the map component has always imported it from.
 *
 * `approximateBounds` and `zoomToFit` moved to `@/lib/geo/mercator` for T-102,
 * so `set_map_view({fit})` can compute a fit without the tool layer importing
 * upwards out of `lib/`; they are re-exported here unchanged, and MapCanvas
 * keeps its import. `visibleBounds` stays: it reads a live map's `unproject`,
 * which is this layer's business and nothing `lib/` should know about.
 */
export { approximateBounds, zoomToFit } from "@/lib/geo/mercator";

/** Just enough of MapLibre's `unproject` to compute a viewport box from it. */
type Unproject = (point: [number, number]) => { lng: number; lat: number };

/**
 * The extent of the corridor a `lanePx`-wide overlay leaves visible on the
 * east edge of a `widthPx` x `heightPx` map, read back through a live map's
 * `unproject`.
 *
 * This exists instead of `map.getBounds()` because the inspector is laid OVER
 * the map: `getBounds()` spans the whole canvas, so at 1440 px nearly a
 * quarter of what it reports as "on screen" is behind opaque glass. `get_map_state` publishes `bounds`
 * and `center` together and `list_features_in_view` filters on `bounds`, so
 * the two have to describe the same rectangle — the one a human can see.
 * `map.setPadding({ right: lane })` already puts `center` at the middle of
 * that corridor; this puts its edges there too.
 *
 * All four corners are unprojected rather than two, so a rotated map reports
 * the box that actually contains the corridor, the same way `getBounds()`
 * does for the full canvas.
 */
export function visibleBounds(
  unproject: Unproject,
  widthPx: number,
  heightPx: number,
  lanePx: number,
): Bounds {
  const right = Math.max(widthPx - lanePx, 0);
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const corner of [
    [0, 0],
    [right, 0],
    [right, heightPx],
    [0, heightPx],
  ] as [number, number][]) {
    const { lng, lat } = unproject(corner);
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}
