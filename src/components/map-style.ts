import type { AddLayerObject } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import { DATASETS, FEATURE_CATEGORIES, type FeatureCategory, type GlassMapFeature } from "@/lib/data/schema";
import { positionsOf } from "./drawing-style";

/** OpenFreeMap — no API key, no usage limits. */
export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * The attribution {@link STYLE_URL} requires, as the MapLibre control renders
 * it on production. We draw it ourselves (`attributionControl: false`) because
 * the design puts it in the bottom bar, inside the corridor the inspector
 * leaves free — the built-in control would sit underneath the inspector.
 * Change this whenever STYLE_URL changes: the links are a licence condition.
 */
export const STYLE_ATTRIBUTION = [
  { href: "https://openfreemap.org", text: "OpenFreeMap" },
  { href: "https://www.openmaptiles.org/", text: "© OpenMapTiles" },
  { href: "https://www.openstreetmap.org/copyright", text: "OpenStreetMap", prefix: "Data from " },
] as const;

/** One colour per category; the legend in StateOverlay reuses these. */
export const CATEGORY_COLOR: Record<FeatureCategory, string> = {
  mrt_station: "#d7263d",
  park: "#2f9e44",
  school: "#1c7ed6",
  supermarket: "#f08c00",
  listing: "#9c36b5",
  district: "#495057",
};

export const CATEGORY_LABEL: Record<FeatureCategory, string> = Object.fromEntries(
  FEATURE_CATEGORIES.map((c) => [c, DATASETS[c].label]),
) as Record<FeatureCategory, string>;

/**
 * How each category is drawn. A point layer exists for every category because
 * OSM can deliver a park or a district as a node rather than a way.
 */
const CATEGORY_SHAPE: Record<FeatureCategory, "point" | "polygon" | "outline"> = {
  mrt_station: "point",
  park: "polygon",
  school: "point",
  supermarket: "point",
  listing: "point",
  district: "outline",
};

export const sourceId = (category: FeatureCategory) => `gm-src-${category}`;

/**
 * MapLibre does not export the style-spec expression types, so layer literals
 * are written untyped and validated by MapLibre at runtime (`map.addLayer`
 * throws on an invalid layer, which surfaces in the `error` handler).
 */
const asLayer = (spec: object) => spec as AddLayerObject;

/** Paint properties are read back when the selection changes. */
export const paintOf = (layer: AddLayerObject): Record<string, unknown> =>
  (layer as { paint?: Record<string, unknown> }).paint ?? {};

/** z<=13 point treatment: the "calm" ramp the landing view is designed around. */
export const CALM_RADIUS = 2;
export const CALM_OPACITY = 0.55;
export const CALM_STROKE_WIDTH = 0.5;

/**
 * Station and listing names only from z14. Below that they printed over every
 * dot in the frame, which is what made the zoomed-out map unreadable.
 */
export const LABEL_MINZOOM = 14;

/**
 * One point per selected feature, feeding the selection halo. Kept in its own
 * source rather than filtering the category sources: a `circle` layer draws a
 * circle at every vertex of a polygon, so a park would get a ring per corner.
 */
export const SELECTION_SOURCE = "gm-src-selection";

/** The halo's teal (= DRAWING_COLOR.agent), cased in white like the map dots. */
export const HALO_COLOR = "#0b7285";

/** Ring size in screen pixels; grows a little with the zoom, like the dots. */
const HALO_RADIUS = ["interpolate", ["linear"], ["zoom"], 10, 7, 16, 11];

const POINTS = ["==", ["geometry-type"], "Point"];
const AREAS = ["!=", ["geometry-type"], "Point"];

/** `true` for features the store currently has selected. */
const selectedExpr = (ids: readonly string[]) => ["in", ["get", "id"], ["literal", [...ids]]];

/**
 * Every layer GlassMap adds on top of the basemap, in draw order.
 * Called again whenever the selection changes: the returned `paint` objects are
 * replayed through `setPaintProperty`, so highlighting needs no extra layers.
 */
export function buildLayerSpecs(selection: readonly string[]): AddLayerObject[] {
  const sel = selectedExpr(selection);
  const specs: AddLayerObject[] = [];

  for (const category of FEATURE_CATEGORIES) {
    if (CATEGORY_SHAPE[category] !== "polygon") continue;
    specs.push(
      asLayer({
        id: `gm-${category}-fill`,
        type: "fill",
        source: sourceId(category),
        filter: AREAS,
        paint: {
          "fill-color": CATEGORY_COLOR[category],
          "fill-opacity": ["case", sel, 0.5, 0.22],
        },
      }),
    );
  }

  for (const category of FEATURE_CATEGORIES) {
    if (CATEGORY_SHAPE[category] === "point") continue;
    specs.push(
      asLayer({
        id: `gm-${category}-line`,
        type: "line",
        source: sourceId(category),
        filter: AREAS,
        paint: {
          "line-color": CATEGORY_COLOR[category],
          "line-width": ["case", sel, 4, 1.5],
          "line-opacity": ["case", sel, 1, 0.75],
        },
      }),
    );
  }

  for (const category of FEATURE_CATEGORIES) {
    const opaque = category === "listing" ? 0.6 : 0.9;
    specs.push(
      asLayer({
        id: `gm-${category}-circle`,
        type: "circle",
        source: sourceId(category),
        filter: POINTS,
        paint: {
          "circle-color": CATEGORY_COLOR[category],
          // Calm ramp: at z<=13 an unselected point is a 2px dot at .55
          // opacity with a hairline stroke, so 2,000 places read as texture
          // instead of confetti. Selected sizes are the same numbers as
          // before (6 at z10, 9 at z13, 12 at z16) — a highlight must not
          // get quieter just because the map is zoomed out.
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            ["case", sel, 6, CALM_RADIUS],
            13,
            ["case", sel, 9, CALM_RADIUS],
            16,
            ["case", sel, 12, 6],
          ],
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            13,
            ["case", sel, opaque, CALM_OPACITY],
            14,
            opaque,
          ],
          "circle-stroke-color": ["case", sel, "#111827", "#ffffff"],
          "circle-stroke-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            13,
            ["case", sel, 3, CALM_STROKE_WIDTH],
            14,
            ["case", sel, 3, 1.5],
          ],
        },
      }),
    );
  }

  // Station names, and an explicit "(sample)" suffix on fabricated listings.
  specs.push(
    asLayer({
      id: "gm-mrt_station-label",
      type: "symbol",
      source: sourceId("mrt_station"),
      minzoom: LABEL_MINZOOM,
      layout: {
        "text-field": ["coalesce", ["get", "name"], ""],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-anchor": "top",
        "text-offset": [0, 0.9],
        "text-optional": true,
      },
      paint: {
        "text-color": ["case", sel, "#111827", CATEGORY_COLOR.mrt_station],
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4,
      },
    }),
  );

  specs.push(
    asLayer({
      id: "gm-listing-label",
      type: "symbol",
      source: sourceId("listing"),
      minzoom: LABEL_MINZOOM,
      layout: {
        "text-field": ["concat", ["coalesce", ["get", "name"], "Listing"], " (sample)"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-anchor": "top",
        "text-offset": [0, 0.9],
        "text-optional": true,
      },
      paint: {
        "text-color": CATEGORY_COLOR.listing,
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4,
      },
    }),
  );

  // The selection halo, on top of everything else GlassMap draws: a
  // white-cased teal ring at the centre of each selected feature. Two layers
  // because a circle layer has one stroke, and the white casing is what keeps
  // the ring readable over a dark park fill as well as over pale streets.
  specs.push(
    asLayer({
      id: "gm-selection-halo-case",
      type: "circle",
      source: SELECTION_SOURCE,
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-radius": HALO_RADIUS,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 5,
        "circle-stroke-opacity": 0.92,
      },
    }),
    asLayer({
      id: "gm-selection-halo",
      type: "circle",
      source: SELECTION_SOURCE,
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-radius": HALO_RADIUS,
        "circle-stroke-color": HALO_COLOR,
        "circle-stroke-width": 2.5,
      },
    }),
  );

  return specs;
}

/**
 * Where each selected feature's ring goes: the average of the feature's own
 * coordinates, which is the anchor rule labelled drawings already use
 * (`labelPointsToGeoJson`). Unknown ids contribute nothing — a tool can select
 * an id before the datasets have finished loading.
 *
 * The points deliberately carry no `id` property: the halo layers are hit by
 * clicks like every other non-symbol layer, and a ring must not become a
 * second, invisible way to toggle the feature underneath it.
 */
export function selectionAnchorsToGeoJson(
  features: readonly GlassMapFeature[],
  selection: readonly string[],
): FeatureCollection {
  const byId = new Map(features.map((feature) => [feature.properties.id, feature]));
  const out: Feature[] = [];
  for (const id of selection) {
    const feature = byId.get(id);
    if (!feature?.geometry) continue;
    const positions = positionsOf(feature.geometry);
    if (positions.length === 0) continue;
    const sum = positions.reduce(([x, y], [lng, lat]) => [x + lng, y + lat], [0, 0]);
    out.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [sum[0] / positions.length, sum[1] / positions.length],
      },
      properties: {},
    });
  }
  return { type: "FeatureCollection", features: out };
}

/**
 * Layer ids that respond to clicks and show a pointer cursor: the data layers
 * only. Labels are excluded so a click never lands on text instead of the
 * thing it names, and the selection halo is excluded because its rings carry
 * no feature id — hovering one showed a pointer that promised a selection the
 * click could not make.
 */
export const INTERACTIVE_LAYER_IDS = buildLayerSpecs([])
  .filter((l) => l.type !== "symbol" && "source" in l && l.source !== SELECTION_SOURCE)
  .map((l) => l.id);
