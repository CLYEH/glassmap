import type { AddLayerObject } from "maplibre-gl";
import { DATASETS, FEATURE_CATEGORIES, type FeatureCategory } from "@/lib/data/schema";

/** OpenFreeMap — no API key, no usage limits. */
export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

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
    specs.push(
      asLayer({
        id: `gm-${category}-circle`,
        type: "circle",
        source: sourceId(category),
        filter: POINTS,
        paint: {
          "circle-color": CATEGORY_COLOR[category],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            ["case", sel, 6, 3],
            16,
            ["case", sel, 12, 6],
          ],
          "circle-opacity": category === "listing" ? 0.6 : 0.9,
          "circle-stroke-color": ["case", sel, "#111827", "#ffffff"],
          "circle-stroke-width": ["case", sel, 3, 1.5],
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

  return specs;
}

/** Layer ids that respond to clicks and show a pointer cursor. */
export const INTERACTIVE_LAYER_IDS = buildLayerSpecs([])
  .filter((l) => l.type !== "symbol")
  .map((l) => l.id);
