import type { AddLayerObject } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, Polygon, Position } from "geojson";
import type { Drawing, LngLat } from "@/lib/store/map-store";

/** Every drawing in the store, agent- and hand-drawn alike. */
export const DRAWING_SOURCE = "gm-src-drawings";
/** One point per labelled drawing; see {@link labelPointsToGeoJson}. */
export const DRAWING_LABEL_SOURCE = "gm-src-drawing-labels";
/** The polygon currently being drawn by hand; empty the rest of the time. */
export const DRAFT_SOURCE = "gm-src-draft";

/**
 * The drawing layers a tap can land on: the fill and both outlines, never the
 * label (a symbol's hit box is the glyphs, so half of a tap on a named circle
 * would answer and half would not) and never the draft (an unfinished shape is
 * not a mark yet).
 *
 * Kept beside the specs that create them so a renamed layer cannot silently
 * stop answering taps; `map-style.ts` keeps `INTERACTIVE_LAYER_IDS` for the
 * same reason.
 */
export const DRAWING_LAYER_IDS = [
  "gm-drawing-fill",
  "gm-drawing-line-agent",
  "gm-drawing-line-user",
] as const;

/**
 * Who drew it. The two sources differ in colour *and* in dash pattern
 * (agent = dashed, user = solid) so the distinction survives a greyscale
 * screenshot, which is how a lot of demo material gets viewed.
 */
export const DRAWING_COLOR: Record<Drawing["source"], string> = {
  agent: "#0b7285",
  user: "#c2255c",
};

/** Dash pattern of the agent outline, in line widths. */
export const AGENT_DASH = [2, 1.5];

const asLayer = (spec: object) => spec as AddLayerObject;

const POINTS = ["==", ["geometry-type"], "Point"];
const LINES = ["==", ["geometry-type"], "LineString"];
const AREAS = ["==", ["geometry-type"], "Polygon"];

const isSource = (source: Drawing["source"]) => ["==", ["get", "source"], source];

/**
 * Layers for `DRAWING_SOURCE` and `DRAFT_SOURCE`, in draw order. Added after
 * the data layers so a drawing is always on top of the features it is about.
 *
 * `line-dasharray` is not data-driven in MapLibre, so agent and user outlines
 * are separate layers filtered on the `source` property rather than one layer
 * with a `case` expression.
 */
export function buildDrawingLayerSpecs(): AddLayerObject[] {
  const bySource = ["case", isSource("user"), DRAWING_COLOR.user, DRAWING_COLOR.agent];

  return [
    asLayer({
      id: "gm-drawing-fill",
      type: "fill",
      source: DRAWING_SOURCE,
      filter: AREAS,
      paint: { "fill-color": bySource, "fill-opacity": 0.18 },
    }),
    asLayer({
      id: "gm-drawing-line-agent",
      type: "line",
      source: DRAWING_SOURCE,
      filter: isSource("agent"),
      paint: {
        "line-color": DRAWING_COLOR.agent,
        "line-width": 2.5,
        "line-dasharray": AGENT_DASH,
      },
    }),
    asLayer({
      id: "gm-drawing-line-user",
      type: "line",
      source: DRAWING_SOURCE,
      filter: isSource("user"),
      paint: { "line-color": DRAWING_COLOR.user, "line-width": 2.5 },
    }),
    asLayer({
      id: "gm-drawing-label",
      type: "symbol",
      source: DRAWING_LABEL_SOURCE,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-optional": true,
      },
      paint: {
        "text-color": bySource,
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4,
      },
    }),
    asLayer({
      id: "gm-draft-fill",
      type: "fill",
      source: DRAFT_SOURCE,
      filter: AREAS,
      paint: { "fill-color": DRAWING_COLOR.user, "fill-opacity": 0.12 },
    }),
    asLayer({
      id: "gm-draft-line",
      type: "line",
      source: DRAFT_SOURCE,
      filter: LINES,
      paint: {
        "line-color": DRAWING_COLOR.user,
        "line-width": 2,
        "line-dasharray": [1.5, 1],
      },
    }),
    asLayer({
      id: "gm-draft-vertex",
      type: "circle",
      source: DRAFT_SOURCE,
      filter: POINTS,
      paint: {
        "circle-radius": 4,
        "circle-color": "#ffffff",
        "circle-stroke-color": DRAWING_COLOR.user,
        "circle-stroke-width": 2,
      },
    }),
  ];
}

/**
 * Drawings as GeoJSON for `DRAWING_SOURCE`. The properties mirror the store,
 * so `label` is absent when the drawing has none rather than present-and-empty;
 * labels themselves are drawn from `DRAWING_LABEL_SOURCE`, which only contains
 * labelled drawings.
 */
export function drawingsToGeoJson(drawings: readonly Drawing[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: drawings.map(
      (drawing): Feature => ({
        type: "Feature",
        id: drawing.id,
        geometry: drawing.geometry,
        properties: {
          id: drawing.id,
          source: drawing.source,
          kind: drawing.kind,
          ...(drawing.label === undefined ? {} : { label: drawing.label }),
        },
      }),
    ),
  };
}

/** Every coordinate in a geometry, flattened. Shared with the selection halo. */
export function positionsOf(geometry: Geometry): Position[] {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "MultiPoint":
    case "LineString":
      return geometry.coordinates;
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates.flat();
    case "MultiPolygon":
      return geometry.coordinates.flat(2);
    case "GeometryCollection":
      return geometry.geometries.flatMap(positionsOf);
  }
}

/**
 * Where a drawing's label goes: the circle's own centre, or the average of the
 * geometry's positions. The average is pulled slightly towards a polygon's
 * repeated closing corner, which is invisible for a text anchor.
 */
function labelAnchor(drawing: Drawing): Position | null {
  if (drawing.center) return drawing.center;
  const positions = positionsOf(drawing.geometry);
  if (positions.length === 0) return null;
  const sum = positions.reduce(([x, y], [lng, lat]) => [x + lng, y + lat], [0, 0]);
  return [sum[0] / positions.length, sum[1] / positions.length];
}

/**
 * Labels as their own point source.
 *
 * Labelling `DRAWING_SOURCE` directly puts one label in every vector tile the
 * shape touches, so a big circle gets its name printed two or three times.
 * One point per drawing gives one label per drawing.
 */
export function labelPointsToGeoJson(drawings: readonly Drawing[]): FeatureCollection {
  const features: Feature[] = [];
  for (const drawing of drawings) {
    if (!drawing.label) continue;
    const anchor = labelAnchor(drawing);
    if (!anchor) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: anchor },
      properties: { id: drawing.id, source: drawing.source, label: drawing.label },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Drops points equal to the one before them, and a last point equal to the first. */
function withoutRepeats(vertices: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const vertex of vertices) {
    const last = out[out.length - 1];
    if (last && last[0] === vertex[0] && last[1] === vertex[1]) continue;
    out.push(vertex);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

/**
 * The polygon a hand-drawn vertex list stands for, or null when there are
 * fewer than three distinct corners - an agent must never be handed a
 * degenerate ring, which a spatial query would silently match nothing against.
 */
export function polygonFromVertices(vertices: readonly LngLat[]): Polygon | null {
  const ring = withoutRepeats(vertices);
  if (ring.length < 3) return null;
  return { type: "Polygon", coordinates: [[...ring, ring[0]].map(([lng, lat]) => [lng, lat])] };
}

/**
 * Live preview of the polygon being drawn: every vertex as a point, plus the
 * rubber band. From three vertices on the band is closed, so what is on screen
 * is the shape that will be stored.
 */
export function draftToGeoJson(vertices: readonly LngLat[]): FeatureCollection {
  const features: Feature[] = vertices.map((vertex) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [vertex[0], vertex[1]] },
    properties: {},
  }));

  if (vertices.length >= 2) {
    const line = vertices.map(([lng, lat]) => [lng, lat]);
    if (vertices.length >= 3) line.push([vertices[0][0], vertices[0][1]]);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: line },
      properties: {},
    });
  }

  const polygon = vertices.length >= 3 ? polygonFromVertices(vertices) : null;
  if (polygon) features.push({ type: "Feature", geometry: polygon, properties: {} });

  return { type: "FeatureCollection", features };
}
