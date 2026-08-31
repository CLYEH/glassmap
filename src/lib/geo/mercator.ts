/**
 * Web Mercator arithmetic: a viewport's extent, and the zoom at which one box
 * fits inside another.
 *
 * It lives in `lib/` rather than beside the map component because both sides of
 * the app need the same two answers and neither may own them. The page computes
 * a corridor for the no-WebGL path (`components/viewport-bounds.ts`, which
 * re-exports these); the tool layer computes a fit for `set_map_view({fit})`
 * (T-102) and must not import upwards out of `lib/`. One copy of the maths is
 * also the only way "the camera the row click asked for" and "the camera the
 * tool asked for" can be provably the same camera.
 *
 * Nothing here touches a live map, MapLibre or the DOM.
 */
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

/** Height of a [west, south, east, north] box in unit-square Mercator, ≥ 0. */
function mercatorHeight(bounds: Bounds): number {
  return mercatorYFromLat(bounds[1]) - mercatorYFromLat(bounds[3]);
}

/**
 * The zoom at which `target` fits inside the rectangle `corridor` currently
 * occupies — the `fitBounds` answer, computed from two boxes instead of from a
 * live map.
 *
 * It takes the corridor rather than a pixel size on purpose. `store.bounds` is
 * already the extent of what a human can see (`visibleBounds` subtracts the
 * inspector's lane; the no-WebGL path computes the same rectangle with
 * `approximateBounds`), so the ratio of the two boxes is the ratio of the two
 * scales — no DOM measurement, no second opinion about where the lane is, and
 * the same answer on a page that never got a GPU. Zoom is log2 of scale, so the
 * whole thing is one logarithm.
 *
 * `fill` is the fraction of the corridor the target is allowed to occupy, i.e.
 * the padding: 0.8 leaves a tenth of the corridor clear on each side.
 *
 * Three known approximations. Two are safe in the direction they err: a
 * rotated map publishes the *bounding box* of its corridor, which is larger
 * than the corridor, so a fit computed while the map is turned can overshoot
 * slightly; and a target with no extent on an axis leaves that axis
 * unconstrained. A target with no extent at all is not a fit at all — there
 * is nothing to frame — so the current zoom comes back unchanged and the
 * caller decides.
 *
 * The third does NOT err safely: on the live-map path `view.zoom` updates
 * synchronously on a click while `bounds` republishes only at `moveend`, so a
 * second fit requested mid-flight measures a fresh zoom against a stale
 * corridor and can land far too wide or too narrow (two rapid area-row
 * clicks). The store self-corrects at landing; the camera does not. A real
 * fix records the zoom the corridor was measured at and corrects by the
 * delta — until then, callers should not chain fits inside one flight.
 * (The network-isolated suite cannot see this: its jumpTo path publishes
 * bounds synchronously.)
 */
export function zoomToFit(
  currentZoom: number,
  corridor: Bounds,
  target: Bounds,
  fill: number,
): number {
  const corridorWidth = corridor[2] - corridor[0];
  const corridorHeight = mercatorHeight(corridor);
  if (!(corridorWidth > 0) || !(corridorHeight > 0)) return currentZoom;

  const targetWidth = target[2] - target[0];
  const targetHeight = mercatorHeight(target);
  // Infinity for an axis with no extent: it constrains nothing, so the other
  // axis decides. Both infinite means the target is a point.
  const byWidth = targetWidth > 0 ? corridorWidth / targetWidth : Infinity;
  const byHeight = targetHeight > 0 ? corridorHeight / targetHeight : Infinity;
  const scale = Math.min(byWidth, byHeight) * fill;
  if (!Number.isFinite(scale) || scale <= 0) return currentZoom;
  return currentZoom + Math.log2(scale);
}
