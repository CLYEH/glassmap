import type { Bounds, MapView } from "@/lib/store/map-store";

/** MapLibre renders 512 px tiles, so the whole world is 512 * 2^zoom pixels. */
const TILE_SIZE = 512;

/** Web Mercator is undefined at the poles; this is the usual cut-off. */
const MAX_LATITUDE = 85.051129;

/** Latitude -> vertical position in the unit-square Mercator world (0 = north). */
function mercatorYFromLat(lat: number): number {
  const clamped = Math.min(Math.max(lat, -MAX_LATITUDE), MAX_LATITUDE);
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))) / 360;
}

/** Inverse of {@link mercatorYFromLat}. */
function latFromMercatorY(y: number): number {
  return (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;
}

/**
 * The extent a viewport of `widthPx` x `heightPx` shows around `view`, computed
 * from Web Mercator maths instead of from a live map.
 *
 * This exists for the no-WebGL path: without it `bounds` would stay null
 * forever and every viewport tool ("what is on screen?") would answer "map not
 * ready" on a page that is otherwise fully functional — which is exactly the
 * headless-CI and blocked-GPU case we promise to keep working.
 *
 * Approximation: bearing and pitch are ignored, so the result is the extent of
 * an unrotated, untilted viewport. When a real map exists its own `getBounds()`
 * wins and this is never used.
 */
export function approximateBounds(view: MapView, widthPx: number, heightPx: number): Bounds {
  const worldSize = TILE_SIZE * Math.pow(2, view.zoom);
  const [lng, lat] = view.center;

  const halfLngSpan = ((widthPx / worldSize) * 360) / 2;
  const halfYSpan = heightPx / worldSize / 2;
  const centerY = mercatorYFromLat(lat);

  return [
    lng - halfLngSpan,
    latFromMercatorY(Math.min(centerY + halfYSpan, 1)),
    lng + halfLngSpan,
    latFromMercatorY(Math.max(centerY - halfYSpan, 0)),
  ];
}

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
