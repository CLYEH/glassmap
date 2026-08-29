import { describe, expect, it } from "vitest";
import type { Position } from "geojson";
import { FEATURE_CATEGORIES, type GlassMapFeature } from "@/lib/data/schema";
import {
  CALM_OPACITY,
  CALM_RADIUS,
  CALM_STROKE_WIDTH,
  INTERACTIVE_LAYER_IDS,
  LABEL_MINZOOM,
  buildLayerSpecs,
  paintOf,
  selectionAnchorsToGeoJson,
  sourceId,
} from "./map-style";

const props = (id: string) => ({ id, name: id, category: "park" as const, source: "osm" as const });

const point = (id: string, at: Position): GlassMapFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: at },
  properties: props(id),
});

/** A closed 1-degree square; its coordinate average is its centre. */
const square = (id: string, lng: number, lat: number): GlassMapFeature => ({
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [lng, lat],
        [lng + 1, lat],
        [lng + 1, lat + 1],
        [lng, lat + 1],
        [lng, lat],
      ],
    ],
  },
  properties: props(id),
});

/**
 * map-style.ts is pure, and these three properties are what the rest of T-03
 * relies on: selection highlighting keys on properties.id, clicks must never
 * hit label layers, and every category must have somewhere to render.
 */
describe("buildLayerSpecs", () => {
  it("highlights the selected features by matching properties.id", () => {
    const selection = ["osm:way:1", "listing:02"];
    const specs = buildLayerSpecs(selection);
    // The selection reaches the layers as an ["in", ["get","id"], [literal ...]]
    // expression, so tools that write store.selection light up the right pixels.
    const wanted = JSON.stringify(["in", ["get", "id"], ["literal", selection]]);
    expect(JSON.stringify(specs)).toContain(wanted);
  });

  it("carries the current selection, not a stale one", () => {
    // An empty selection must still key on id (with an empty literal), otherwise
    // deselection could never clear a highlight.
    expect(JSON.stringify(buildLayerSpecs([]))).toContain(
      JSON.stringify(["in", ["get", "id"], ["literal", []]]),
    );
  });

  it("gives every category a source to render into", () => {
    const specs = buildLayerSpecs([]);
    for (const category of FEATURE_CATEGORIES) {
      const src = sourceId(category);
      expect(specs.some((l) => (l as { source?: string }).source === src)).toBe(true);
    }
  });
});

describe("INTERACTIVE_LAYER_IDS", () => {
  it("excludes symbol/label layers so a click never lands on a label", () => {
    const symbolIds = new Set(
      buildLayerSpecs([])
        .filter((l) => l.type === "symbol")
        .map((l) => l.id),
    );
    expect(symbolIds.size).toBeGreaterThan(0);
    for (const id of INTERACTIVE_LAYER_IDS) expect(symbolIds.has(id)).toBe(false);
  });

  it("is exactly the non-symbol layers", () => {
    const nonSymbol = buildLayerSpecs([])
      .filter((l) => l.type !== "symbol")
      .map((l) => l.id);
    expect(INTERACTIVE_LAYER_IDS).toEqual(nonSymbol);
  });
});

/**
 * A tiny reader for the two expression shapes the point paint uses. It only
 * looks up exact zoom stops, which is all these assertions need and keeps the
 * test from re-implementing MapLibre's interpolation.
 */
type Expr = unknown;

function atZoom(expr: Expr, zoom: number): Expr {
  const list = expr as unknown[];
  if (!Array.isArray(list) || list[0] !== "interpolate") return expr;
  for (let i = 3; i < list.length; i += 2) {
    if (list[i] === zoom) return list[i + 1];
  }
  throw new Error(`no stop at zoom ${zoom} in ${JSON.stringify(expr)}`);
}

function forSelected(expr: Expr, selected: boolean): Expr {
  const list = expr as unknown[];
  if (!Array.isArray(list) || list[0] !== "case") return expr;
  return selected ? list[2] : list[3];
}

const pointPaint = (selection: string[] = []) =>
  paintOf(buildLayerSpecs(selection).find((l) => l.id === "gm-park-circle")!);

describe("the calm ramp below z14", () => {
  it("draws an unselected place as a 2px dot at .55 opacity with a hairline stroke", () => {
    // 2,063 places at z12 are the whole city at once: at full size and full
    // opacity they read as confetti and the basemap underneath disappears.
    const paint = pointPaint();
    expect(forSelected(atZoom(paint["circle-radius"], 13), false)).toBe(CALM_RADIUS);
    expect(forSelected(atZoom(paint["circle-opacity"], 13), false)).toBe(CALM_OPACITY);
    expect(forSelected(atZoom(paint["circle-stroke-width"], 13), false)).toBe(CALM_STROKE_WIDTH);
  });

  it("does not quieten a selected place at the same zoom", () => {
    // The highlight is the answer to "which ones did you mean": it has to stay
    // exactly as loud as it was before the ramp existed (6 at z10, 12 at z16).
    const paint = pointPaint(["osm:way:1"]);
    expect(forSelected(atZoom(paint["circle-radius"], 10), true)).toBe(6);
    expect(forSelected(atZoom(paint["circle-radius"], 13), true)).toBe(9);
    expect(forSelected(atZoom(paint["circle-radius"], 16), true)).toBe(12);
    expect(forSelected(atZoom(paint["circle-opacity"], 13), true)).toBe(0.9);
  });

  it("keeps station and listing names off the map until z14", () => {
    // Below z14 those two label layers printed a name on every dot in the
    // frame, which is what made the landing view unreadable.
    for (const id of ["gm-mrt_station-label", "gm-listing-label"]) {
      const layer = buildLayerSpecs([]).find((l) => l.id === id) as { minzoom?: number };
      expect(layer.minzoom).toBe(LABEL_MINZOOM);
    }
  });
});

describe("the selection halo", () => {
  it("is drawn after everything else GlassMap adds", () => {
    // A ring under a park fill proves nothing. It is the last thing drawn so
    // "highlighted all 8" can be counted by eye.
    const ids = buildLayerSpecs([]).map((l) => l.id);
    expect(ids.slice(-2)).toEqual(["gm-selection-halo-case", "gm-selection-halo"]);
  });

  it("puts one ring at the centre of each selected feature", () => {
    const features = [
      point("osm:node:1", [121.5, 25]),
      square("osm:way:2", 121, 25),
      point("osm:node:3", [121.6, 25.1]),
    ];
    const collection = selectionAnchorsToGeoJson(features, ["osm:way:2", "osm:node:3"]);
    expect(collection.features.map((f) => f.geometry)).toEqual([
      { type: "Point", coordinates: [121.4, 25.4] },
      { type: "Point", coordinates: [121.6, 25.1] },
    ]);
  });

  it("carries no feature id, so a ring is not a second way to toggle a feature", () => {
    // The halo layers are ordinary circle layers and get the click like any
    // other; if the ring carried the id, clicking it would deselect what it is
    // pointing at.
    const one = selectionAnchorsToGeoJson([point("osm:node:1", [121.5, 25])], ["osm:node:1"]);
    expect(one.features[0].properties).toEqual({});
  });

  it("ignores ids the data does not have", () => {
    // A tool can select an id before the datasets have finished loading, and
    // an unplaceable id must not become a ring at [0, 0].
    expect(selectionAnchorsToGeoJson([], ["osm:node:404"]).features).toEqual([]);
  });
});
