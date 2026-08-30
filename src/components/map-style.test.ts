import { describe, expect, it, vi } from "vitest";
import type { Position } from "geojson";
import { FEATURE_CATEGORIES, type GlassMapFeature } from "@/lib/data/schema";
import type { MapFeature, Tier2Category } from "@/lib/store/tier2";
import {
  CALM_OPACITY,
  CALM_RADIUS,
  CALM_STROKE_WIDTH,
  INTERACTIVE_LAYER_IDS,
  LABEL_MINZOOM,
  POI_SOURCE,
  SELECTED_OPACITY,
  SELECTED_RADIUS,
  SELECTED_STATE,
  SELECTION_SOURCE,
  buildLayerSpecs,
  categorySourceSpec,
  featureSourceIndex,
  paintOf,
  selectedPoiFeatures,
  selectionAnchorsToGeoJson,
  sourceId,
  syncSelectionState,
  type FeatureStateTarget,
} from "./map-style";

const props = (id: string) => ({ id, name: id, category: "park" as const, source: "osm" as const });

const point = (id: string, at: Position): GlassMapFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: at },
  properties: props(id),
});

const poi = (id: string, at: Position, category: Tier2Category = "cafe"): MapFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: at },
  properties: { id, name: id, category, source: "osm" },
});

/**
 * A closed 1-degree square. Its coordinate average is NOT its centre: the ring
 * repeats the first corner to close itself, so the average of the five stored
 * positions is pulled 0.1 deg toward the south-west corner — [lng+0.4,
 * lat+0.4] rather than [lng+0.5, lat+0.5]. That bias is what the halo anchor
 * actually has, and the assertion below states it rather than hiding it.
 */
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
 * map-style.ts is pure, and these properties are what the rest of the map
 * relies on: the selected look is driven by feature state, clicks must never
 * hit label layers, and every category must have somewhere to render.
 */
describe("buildLayerSpecs", () => {
  it("highlights the selected features from feature state", () => {
    // The map marks a selected feature with `setFeatureState({selected:true})`
    // and the paint reads it back. This is the whole contract between
    // MapCanvas and the style; if the key or the shape drifts, the highlight
    // silently stops appearing while every test that counts ids stays green.
    const wanted = JSON.stringify(["boolean", ["feature-state", "selected"], false]);
    expect(JSON.stringify(buildLayerSpecs())).toContain(wanted);
  });

  it("never embeds the selected ids in an expression", () => {
    // `["in", ["get","id"], ["literal", ids]]` costs a linear scan of the id
    // array per feature per evaluation pass, and rewriting it on every
    // selection change re-evaluates the paint array for every feature in the
    // source. At a few thousand selected ids that was seconds per change; the
    // layers must therefore not depend on the selection at all.
    expect(buildLayerSpecs.length).toBe(0);
    const json = JSON.stringify(buildLayerSpecs());
    expect(json).not.toContain('"literal"');
    expect(json).not.toContain('["get","id"]');
  });

  it("keeps the selected look in paint, where feature state is legal", () => {
    // MapLibre evaluates `filter` and `layout` without a feature state, so a
    // selection-dependent value there would either throw at addLayer or
    // silently never light up.
    for (const layer of buildLayerSpecs()) {
      const { filter, layout } = layer as { filter?: unknown; layout?: unknown };
      expect(JSON.stringify(filter ?? null)).not.toContain("feature-state");
      expect(JSON.stringify(layout ?? null)).not.toContain("feature-state");
    }
  });

  it("gives every category a source to render into", () => {
    const specs = buildLayerSpecs();
    for (const category of FEATURE_CATEGORIES) {
      const src = sourceId(category);
      expect(specs.some((l) => (l as { source?: string }).source === src)).toBe(true);
    }
  });
});

describe("the sources the selection is addressed through", () => {
  it("promotes properties.id to the feature id", () => {
    // `map.setFeatureState` addresses a feature by feature id, and a GeoJSON
    // feature has none of its own. Without promoteId every call would target
    // an id no feature has and nothing would ever highlight.
    expect(categorySourceSpec().promoteId).toBe("id");
    expect(categorySourceSpec().data).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("says which source each feature id lives in", () => {
    // Feature state is stored per source, so a selected id is unusable until
    // its category is known.
    const index = featureSourceIndex([point("osm:node:1", [121.5, 25])]);
    expect(index.get("osm:node:1")).toBe(sourceId("park"));
    expect(index.get("osm:node:404")).toBeUndefined();
  });
});

describe("INTERACTIVE_LAYER_IDS", () => {
  it("excludes symbol/label layers so a click never lands on a label", () => {
    const symbolIds = new Set(
      buildLayerSpecs()
        .filter((l) => l.type === "symbol")
        .map((l) => l.id),
    );
    expect(symbolIds.size).toBeGreaterThan(0);
    for (const id of INTERACTIVE_LAYER_IDS) expect(symbolIds.has(id)).toBe(false);
  });

  it("excludes the selection halo, which is decoration with nothing to select", () => {
    // The halo rings carry no feature id (see below), so a click on one can
    // never resolve to a feature. Leaving them interactive gave the user a
    // pointer cursor over a target that silently does nothing.
    const halo = buildLayerSpecs()
      .filter((l) => "source" in l && l.source === SELECTION_SOURCE)
      .map((l) => l.id);
    expect(halo.length).toBe(2);
    for (const id of halo) expect(INTERACTIVE_LAYER_IDS).not.toContain(id);
  });

  it("is exactly the per-category data layers", () => {
    const data = buildLayerSpecs()
      .filter((l) => l.type !== "symbol" && "source" in l && l.source !== SELECTION_SOURCE)
      .map((l) => l.id);
    expect(INTERACTIVE_LAYER_IDS).toEqual(data);
    expect(INTERACTIVE_LAYER_IDS.length).toBeGreaterThan(0);
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

const pointPaint = () => paintOf(buildLayerSpecs().find((l) => l.id === "gm-park-circle")!);

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
    const paint = pointPaint();
    expect(forSelected(atZoom(paint["circle-radius"], 10), true)).toBe(6);
    expect(forSelected(atZoom(paint["circle-radius"], 13), true)).toBe(9);
    expect(forSelected(atZoom(paint["circle-radius"], 16), true)).toBe(12);
    expect(forSelected(atZoom(paint["circle-opacity"], 13), true)).toBe(0.9);
  });

  it("keeps station and listing names off the map until z14", () => {
    // Below z14 those two label layers printed a name on every dot in the
    // frame, which is what made the landing view unreadable.
    for (const id of ["gm-mrt_station-label", "gm-listing-label"]) {
      const layer = buildLayerSpecs().find((l) => l.id === id) as { minzoom?: number };
      expect(layer.minzoom).toBe(LABEL_MINZOOM);
    }
  });
});

describe("the selection halo", () => {
  it("is drawn after everything else GlassMap adds", () => {
    // A ring under a park fill proves nothing. It is the last thing drawn so
    // "highlighted all 8" can be counted by eye.
    const ids = buildLayerSpecs().map((l) => l.id);
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
    // The rings are the reason INTERACTIVE_LAYER_IDS excludes their source: a
    // ring that carried the id of the feature it points at would deselect that
    // feature when clicked, and one that does not is not a target at all.
    const one = selectionAnchorsToGeoJson([point("osm:node:1", [121.5, 25])], ["osm:node:1"]);
    expect(one.features[0].properties).toEqual({});
  });

  it("ignores ids the data does not have", () => {
    // A tool can select an id before the datasets have finished loading, and
    // an unplaceable id must not become a ring at [0, 0].
    expect(selectionAnchorsToGeoJson([], ["osm:node:404"]).features).toEqual([]);
  });

  it("rings a selected POI exactly like a bundled feature", () => {
    // Tier-2 features live in no category source, so before they were passed
    // in a selected cafe was the one highlighted thing on the map with no ring
    // around it — "these are the 14 I mean" pointing at nothing.
    const collection = selectionAnchorsToGeoJson(
      [point("osm:node:1", [121.5, 25])],
      ["osm:node:1", "osm:node:7"],
      [poi("osm:node:7", [121.55, 25.03])],
    );
    expect(collection.features.map((f) => f.geometry)).toEqual([
      { type: "Point", coordinates: [121.5, 25] },
      { type: "Point", coordinates: [121.55, 25.03] },
    ]);
  });

  it("lets a bundled feature win an id a POI file also carries", () => {
    // The store applies the same precedence when it appends a category
    // (`appendTier2Features` skips a bundled id), so the ring has to agree
    // with the geometry the rest of the map is drawing.
    const collection = selectionAnchorsToGeoJson(
      [point("osm:node:1", [121.5, 25])],
      ["osm:node:1"],
      [poi("osm:node:1", [0, 0])],
    );
    expect(collection.features[0].geometry).toEqual({ type: "Point", coordinates: [121.5, 25] });
  });
});

/**
 * Tier-2 ships unpainted — 31k POIs would be 6-13x the density the calm ramp
 * was verified at — but what someone explicitly acted on has to be visible.
 * The whole treatment rests on one invariant: POI_SOURCE holds the selected
 * tier-2 features and nothing else, so "in the source" *is* "selected".
 */
describe("the materialised POI dot", () => {
  const layer = () => buildLayerSpecs().find((l) => l.id === "gm-poi-circle")!;

  it("draws only what is selected", () => {
    const loaded = [poi("osm:node:1", [121.5, 25]), poi("osm:node:2", [121.6, 25.1])];
    expect(selectedPoiFeatures(loaded, ["osm:node:2"]).map((f) => f.properties.id)).toEqual([
      "osm:node:2",
    ]);
  });

  it("empties the moment the selection is cleared, so the calm map comes back", () => {
    // Deselect is the only way a POI leaves the screen: the category stays in
    // memory for the tools, and off the canvas.
    const loaded = [poi("osm:node:1", [121.5, 25])];
    expect(selectedPoiFeatures(loaded, [])).toEqual([]);
  });

  it("ignores selected ids that belong to no loaded category", () => {
    expect(selectedPoiFeatures([poi("osm:node:1", [121.5, 25])], ["osm:node:404"])).toEqual([]);
  });

  it("needs no feature state, because membership is selection", () => {
    // The bundled layers read `["feature-state","selected"]`; this one must
    // not. If it did, a POI whose state had not been written yet would render
    // at the *unselected* calm size — a 2px dot for the one feature the agent
    // just said it was pointing at.
    expect(JSON.stringify(layer())).not.toContain("feature-state");
    expect((layer() as { source?: string }).source).toBe(POI_SOURCE);
  });

  it("is the same size as a selected bundled dot at every stop", () => {
    // "Selected" has to be one size on this map. If a cafe's highlight were a
    // different size from a park's, the size would start meaning "which tier
    // is this" instead of "this is the one I meant".
    const bundled = paintOf(buildLayerSpecs().find((l) => l.id === "gm-park-circle")!);
    const poiPaint = paintOf(layer());
    for (const [zoom, radius] of [
      [10, SELECTED_RADIUS[0]],
      [13, SELECTED_RADIUS[1]],
      [16, SELECTED_RADIUS[2]],
    ] as const) {
      expect(forSelected(atZoom(bundled["circle-radius"], zoom), true)).toBe(radius);
      expect(atZoom(poiPaint["circle-radius"], zoom)).toBe(radius);
    }
    expect(poiPaint["circle-opacity"]).toBe(SELECTED_OPACITY);
    expect(forSelected(atZoom(bundled["circle-opacity"], 13), true)).toBe(SELECTED_OPACITY);
  });

  it("is drawn under the halo that rings it", () => {
    const ids = buildLayerSpecs().map((l) => l.id);
    expect(ids.indexOf("gm-poi-circle")).toBeGreaterThan(-1);
    expect(ids.indexOf("gm-poi-circle")).toBeLessThan(ids.indexOf("gm-selection-halo-case"));
  });

  it("is clickable, so the dot you can see is the dot you can deselect", () => {
    expect(INTERACTIVE_LAYER_IDS).toContain("gm-poi-circle");
  });

  it("stays out of the feature-state index", () => {
    // Nothing reads feature state on POI_SOURCE, so writing it would be state
    // that no paint consults — and would make `syncSelectionState` report a
    // highlight it did not cause.
    const index = featureSourceIndex([point("osm:node:1", [121.5, 25])]);
    expect([...index.values()]).not.toContain(POI_SOURCE);
  });
});

/**
 * The selection diff — the one piece of the feature-state highlight with no
 * other net under it. The e2e suite runs network-isolated, so the basemap never
 * loads and no browser test ever executes this path; if the diff regresses, the
 * highlight silently stops matching `store.selection` and everything else stays
 * green.
 */
describe("syncSelectionState", () => {
  const PARK = sourceId("park");
  const SCHOOL = sourceId("school");
  /** Three loaded features across two sources: state is stored per source. */
  const loaded = new Map([
    ["a", PARK],
    ["b", SCHOOL],
    ["c", PARK],
  ]);

  const spies = () => ({
    setFeatureState: vi.fn<(target: FeatureStateTarget, state: Record<string, boolean>) => void>(),
    removeFeatureState: vi.fn<(target: FeatureStateTarget, key: string) => void>(),
  });

  it("sets only the ids that entered the selection", () => {
    // Adding one place to a selection of 500 must cost one setFeatureState,
    // not 501: re-flagging the whole selection is exactly the paint-array
    // update this mechanism was built to stop doing.
    const calls = spies();
    const applied = syncSelectionState({
      selection: ["a", "b"],
      applied: new Map([["a", PARK]]),
      featureSources: loaded,
      ...calls,
    });
    expect(calls.setFeatureState.mock.calls).toEqual([[{ source: SCHOOL, id: "b" }, { selected: true }]]);
    expect(calls.removeFeatureState).not.toHaveBeenCalled();
    expect(applied).toEqual(
      new Map([
        ["a", PARK],
        ["b", SCHOOL],
      ]),
    );
  });

  it("removes only the ids that left, and only our own state key", () => {
    // `removeFeatureState({source, id})` with no key drops *every* state on the
    // feature. Nothing else writes feature state today, so a blanket removal
    // would look correct until the first time something does.
    const calls = spies();
    const applied = syncSelectionState({
      selection: ["a"],
      applied: new Map([
        ["a", PARK],
        ["b", SCHOOL],
      ]),
      featureSources: loaded,
      ...calls,
    });
    expect(calls.removeFeatureState.mock.calls).toEqual([[{ source: SCHOOL, id: "b" }, SELECTED_STATE]]);
    expect(calls.setFeatureState).not.toHaveBeenCalled();
    expect(applied).toEqual(new Map([["a", PARK]]));
  });

  it("touches nothing when the selection only shifts around", () => {
    // A refinement typically swaps a few ids. The ones that stayed selected are
    // already flagged and must not be re-written.
    const calls = spies();
    const applied = syncSelectionState({
      selection: ["b", "c"],
      applied: new Map([
        ["a", PARK],
        ["b", SCHOOL],
      ]),
      featureSources: loaded,
      ...calls,
    });
    expect(calls.removeFeatureState.mock.calls).toEqual([[{ source: PARK, id: "a" }, SELECTED_STATE]]);
    expect(calls.setFeatureState.mock.calls).toEqual([[{ source: PARK, id: "c" }, { selected: true }]]);
    expect(applied).toEqual(
      new Map([
        ["b", SCHOOL],
        ["c", PARK],
      ]),
    );
  });

  it("skips ids no dataset has yet, without touching the map", () => {
    // A tool can select before the datasets finish loading. Feature state needs
    // a source to write to, and guessing one would write onto a source that
    // does not hold the feature.
    const calls = spies();
    const applied = syncSelectionState({
      selection: ["osm:node:404"],
      applied: new Map(),
      featureSources: loaded,
      ...calls,
    });
    expect(calls.setFeatureState).not.toHaveBeenCalled();
    expect(calls.removeFeatureState).not.toHaveBeenCalled();
    expect(applied).toEqual(new Map());
  });

  it("picks up a select-before-load id when the data arrives", () => {
    // The whole reason `reapply` exists: select while nothing is loaded (no
    // call is possible), then feature data lands and the same selection has to
    // light up. `reapply` also re-states ids that were already flagged, because
    // `setData` reloads the source's tiles and what survives that is MapLibre's
    // business, not a guarantee the highlight may lean on.
    const calls = spies();
    const early = syncSelectionState({
      selection: ["a", "b"],
      applied: new Map(),
      featureSources: new Map(),
      ...calls,
    });
    expect(calls.setFeatureState).not.toHaveBeenCalled();
    expect(early).toEqual(new Map());

    const afterLoad = syncSelectionState({
      selection: ["a", "b"],
      applied: new Map([["a", PARK]]),
      featureSources: loaded,
      reapply: true,
      ...calls,
    });
    expect(calls.setFeatureState.mock.calls).toEqual([
      [{ source: PARK, id: "a" }, { selected: true }],
      [{ source: SCHOOL, id: "b" }, { selected: true }],
    ]);
    expect(afterLoad).toEqual(
      new Map([
        ["a", PARK],
        ["b", SCHOOL],
      ]),
    );
  });

  it("clears exactly the ids it had flagged when the selection empties", () => {
    // "Clear selection" has to leave no stale highlight behind, and it must not
    // reach for ids it never set - `applied`, not the whole feature index, is
    // the list of what is on the map.
    const calls = spies();
    const applied = syncSelectionState({
      selection: [],
      applied: new Map([
        ["a", PARK],
        ["b", SCHOOL],
      ]),
      featureSources: loaded,
      ...calls,
    });
    expect(calls.removeFeatureState.mock.calls).toEqual([
      [{ source: PARK, id: "a" }, SELECTED_STATE],
      [{ source: SCHOOL, id: "b" }, SELECTED_STATE],
    ]);
    expect(calls.setFeatureState).not.toHaveBeenCalled();
    expect(applied).toEqual(new Map());
  });

  it("moves the flag when a feature's data changes category", () => {
    // Why the applied ids are tracked with their source rather than as a plain
    // set: state written on the old source stays there forever if it is not
    // removed from *that* source, so the feature would keep a highlight nothing
    // can clear.
    const calls = spies();
    const applied = syncSelectionState({
      selection: ["a"],
      applied: new Map([["a", PARK]]),
      featureSources: new Map([["a", SCHOOL]]),
      ...calls,
    });
    expect(calls.removeFeatureState.mock.calls).toEqual([[{ source: PARK, id: "a" }, SELECTED_STATE]]);
    expect(calls.setFeatureState.mock.calls).toEqual([[{ source: SCHOOL, id: "a" }, { selected: true }]]);
    expect(applied).toEqual(new Map([["a", SCHOOL]]));
  });
});
