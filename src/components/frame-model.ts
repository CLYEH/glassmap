/**
 * The row-click camera, where it has always been imported from.
 *
 * The maths moved to `@/lib/geo/frame` for T-102, so `set_map_view({fit})` can
 * frame the same thing the same way without the tool layer importing upwards
 * out of `lib/`. Nothing about it changed: this file re-exports the module
 * whole, and `Inspector.tsx` — plus every test written against T-101 — keeps
 * its import.
 */
export {
  boundsCenter,
  frameFor,
  frameForPoint,
  geometryBounds,
  hasExtent,
  ROW_FIT_FILL,
  ROW_FIT_MAX_ZOOM,
  ROW_FIT_MIN_ZOOM,
  ROW_POINT_ZOOM,
  type Frame,
} from "@/lib/geo/frame";
