import type { Geometry, Position } from "geojson";
import type { Bounds, LngLat, MapView } from "@/lib/store/map-store";
import { zoomToFit } from "./viewport-bounds";

/**
 * Where the camera goes when a person clicks a row in the inspector.
 *
 * The inspector lists what is on the map; until T-101 it only listed it. A row
 * click is the plainest question a list can be asked — *show me that one* — and
 * this module is the whole of the answer: a `{ center, zoom }` for the store,
 * derived from the thing's own extent and the rectangle the person is currently
 * looking at.
 *
 * **It is the human acting, and nothing here changes that.** The caller writes
 * `setView`, which is the same write a pan makes; no tool is called, no
 * activity row is recorded, and the awakening (`lib/awaken`, which reads
 * `activity` and `restoredAgentState`) never hears about it. The camera chip
 * and the share hash both read `view` from the store, so they follow for free.
 */

/**
 * Where a click lands on a thing with no extent — a point of interest, a pinned
 * note — when the camera is further out than this.
 *
 * The same number the search box picks with (`SEARCH_ZOOM` in `search-model`),
 * which is itself the same number `set_map_view({ place })` uses (`PLACE_ZOOM`
 * in `map-tools/index.ts`). Restated rather than imported, for the reason
 * `search-model` restates it: these are three surfaces that happen to agree,
 * not one surface with three call sites, and the human path must not depend on
 * the tool registry.
 */
export const ROW_POINT_ZOOM = 15;

/**
 * How much of the visible corridor a framed area is allowed to fill. The rest
 * is the padding: 0.8 leaves a tenth of the corridor clear on every side, so a
 * district lands inside the frame instead of flush against its edges.
 */
export const ROW_FIT_FILL = 0.8;

/**
 * The closest a fit may go. A 6 m circle drawn by hand fits at zoom 21, which
 * is a screenful of one doorway with no context at all; this stops the flight
 * at the scale where the street it is on is still readable.
 */
export const ROW_FIT_MAX_ZOOM = 17;

/**
 * The furthest a fit may go. Only a broken or world-sized extent can reach it —
 * it is a floor against a degenerate bbox, not a design choice about framing.
 */
export const ROW_FIT_MIN_ZOOM = 2;

/** What a row click asks the store for. */
export interface Frame {
  center: LngLat;
  zoom: number;
}

const isFiniteNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Grow `box` (mutated) to include one [lng, lat] position. */
function extend(box: number[], position: Position): void {
  const [lng, lat] = position;
  if (!isFiniteNum(lng) || !isFiniteNum(lat)) return;
  if (lng < box[0]) box[0] = lng;
  if (lat < box[1]) box[1] = lat;
  if (lng > box[2]) box[2] = lng;
  if (lat > box[3]) box[3] = lat;
}

/** Walk any depth of GeoJSON coordinate nesting, extending `box` at the leaves. */
function walk(box: number[], coordinates: unknown): void {
  if (!Array.isArray(coordinates)) return;
  if (isFiniteNum(coordinates[0]) && isFiniteNum(coordinates[1])) {
    extend(box, coordinates as Position);
    return;
  }
  for (const child of coordinates) walk(box, child);
}

/**
 * [west, south, east, north] of a raw geometry, or null when it holds no usable
 * coordinate.
 *
 * A drawing carries a `Geometry`, not a `Feature`, so `featureBounds`
 * (`map-tools/output`) cannot be handed one without fabricating a feature
 * around it. This is the same box by a shorter route: no projection, no
 * dependency, and it degrades to null rather than throwing — a shape the page
 * cannot frame simply does not offer to be framed.
 */
export function geometryBounds(geometry: Geometry | null | undefined): Bounds | null {
  if (!geometry) return null;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries ?? []) {
      const childBox = geometryBounds(child);
      if (childBox) {
        extend(box, [childBox[0], childBox[1]]);
        extend(box, [childBox[2], childBox[3]]);
      }
    }
  } else {
    walk(box, geometry.coordinates);
  }
  if (!box.every(isFiniteNum)) return null;
  return [box[0], box[1], box[2], box[3]];
}

/** The middle of a [west, south, east, north] box. */
export function boundsCenter(bounds: Bounds): LngLat {
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

/** True when the box covers ground rather than naming a single point. */
export function hasExtent(bounds: Bounds): boolean {
  return bounds[2] > bounds[0] || bounds[3] > bounds[1];
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/**
 * The camera a row click asks for, given what was clicked (`target`), where the
 * person is now (`view`) and how much of the map they can see (`corridor`,
 * i.e. `store.bounds` — null before the map has reported one).
 *
 * Two rules, because there are two kinds of thing in that list:
 *
 *  - **A point** — a cafe, a pinned note, a place whose bbox is one coordinate
 *    — has no extent to respect, so there is no "right" zoom for it and the
 *    courteous answer is the search box's: fly to it and **never zoom out**
 *    (`ROW_POINT_ZOOM` is a floor, not a target). Somebody who framed a
 *    neighbourhood keeps their frame.
 *  - **An area** — a district, a park, a drawn circle or route — *is* its
 *    extent, so it is fitted: the click means "show me this thing", and a fit
 *    that refused to widen would answer a click on 大安區 with one of its
 *    street corners. This is the one case where the camera can end up further
 *    out than it started, and only when the person was already inside the thing
 *    they asked to see, where "zoom in" has nothing left to mean.
 *
 * With no corridor to measure against, an area falls back to the point rule:
 * the honest answer to "I do not know how much you can see" is to change as
 * little as possible.
 */
export function frameFor(target: Bounds, view: MapView, corridor: Bounds | null): Frame {
  const center = boundsCenter(target);
  if (!hasExtent(target) || !corridor) {
    return { center, zoom: Math.max(view.zoom, ROW_POINT_ZOOM) };
  }
  const fitted = zoomToFit(view.zoom, corridor, target, ROW_FIT_FILL);
  return { center, zoom: clamp(fitted, ROW_FIT_MIN_ZOOM, ROW_FIT_MAX_ZOOM) };
}

/** The point rule on its own, for a thing that is only ever a coordinate. */
export function frameForPoint(at: LngLat, view: MapView): Frame {
  return { center: at, zoom: Math.max(view.zoom, ROW_POINT_ZOOM) };
}
