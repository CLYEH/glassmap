import { describe, expect, it } from "vitest";
import type { Position } from "geojson";
import type { MapFeature, Tier2Category } from "@/lib/store/tier2";
import {
  BEAD_CLUSTER_LAYER,
  BEAD_LAYER,
  BEAD_LAYER_IDS,
  BEAD_RADIUS,
  BROWSE_BEAD_LAYER,
  BROWSE_BUDGET_K,
  BROWSE_GRAIN_LAYER,
  BROWSE_TIER_MINIMUM,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS_PX,
  beadAnchorsToGeoJson,
  beadSourceSpec,
  browseBeadFilter,
  browseGrainFilter,
  browsePointsToGeoJson,
  browseSourceSpec,
  browseTierMinimum,
  buildBeadLayerSpecs,
  countedClusterThreshold,
  selectionProvenance,
} from "./bead-style";
import { BEAD_BAKE_RADIUS, GLOW_ALPHA, beadImageId } from "./bead-sprite";
import { buildDrawingLayerSpecs } from "./drawing-style";
import { buildLayerSpecs } from "./map-style";

const poi = (id: string, at: Position, category: Tier2Category = "cafe"): MapFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: at },
  properties: { id, name: id, category, source: "osm" },
});

/** A POI mapped as a building outline rather than a node — one bead, not four. */
const outline = (id: string, lng: number, lat: number): MapFeature => ({
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
  properties: { id, name: id, category: "cafe", source: "osm" },
});

const layer = (id: string) => buildBeadLayerSpecs().find((l) => l.id === id)!;
const layoutOf = (id: string) => (layer(id) as { layout?: Record<string, unknown> }).layout ?? {};

/**
 * Evaluate a `text-size` expression for one cluster count. Small enough to be
 * obviously right, and the only way to check a *rendered* size: the expression
 * is a nest of min/max/ln, so reading its shape would say nothing about the
 * number a human ends up looking at.
 */
const sizeFor = (expression: unknown, count: number): number => {
  if (typeof expression === "number") return expression;
  if (!Array.isArray(expression)) throw new Error(`not an expression: ${expression}`);
  const [op, ...args] = expression as [string, ...unknown[]];
  if (op === "get") return count; // `point_count`, the only property in there
  const values = args.map((arg) => sizeFor(arg, count));
  if (op === "max") return Math.max(...values);
  if (op === "min") return Math.min(...values);
  if (op === "+") return values.reduce((a, b) => a + b, 0);
  if (op === "*") return values.reduce((a, b) => a * b, 1);
  if (op === "ln") return Math.log(values[0]);
  throw new Error(`unhandled operator: ${op}`);
};
const paintOf = (id: string) => (layer(id) as { paint?: Record<string, unknown> }).paint ?? {};

describe("bead anchors", () => {
  it("puts one bead at the centre of each selected place, in selection order", () => {
    const collection = beadAnchorsToGeoJson(
      [poi("osm:node:1", [121.5, 25]), outline("osm:way:2", 121, 25)],
      ["osm:way:2", "osm:node:1"],
    );
    expect(collection.features.map((f) => f.geometry)).toEqual([
      // The ring repeats its first corner, so the coordinate average sits
      // south-west of the true centre — the same anchor bias the drawing
      // labels and the selection rings have, stated rather than hidden.
      { type: "Point", coordinates: [121.4, 25.4] },
      { type: "Point", coordinates: [121.5, 25] },
    ]);
  });

  it("reduces a place to a point, because clusters are made of points", () => {
    // Supercluster only takes points, and a bead marks a *place*: an outlined
    // cafe gets one bead at its centre, not a bead per building corner.
    const collection = beadAnchorsToGeoJson([outline("osm:way:2", 0, 0)], ["osm:way:2"]);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].geometry.type).toBe("Point");
  });

  it("carries the id, so the bead you can see is the bead you can deselect", () => {
    const collection = beadAnchorsToGeoJson([poi("osm:node:1", [121.5, 25])], ["osm:node:1"]);
    expect(collection.features[0].properties?.id).toBe("osm:node:1");
  });

  it("marks a place the store says a human selected as the human's", () => {
    const collection = beadAnchorsToGeoJson(
      [poi("osm:node:1", [121.5, 25]), poi("osm:node:2", [121.6, 25])],
      ["osm:node:1", "osm:node:2"],
      { "osm:node:2": "user" },
    );
    expect(collection.features.map((f) => f.properties?.prov)).toEqual(["agent", "user"]);
  });

  it("presumes the agent for an id nobody recorded", () => {
    // Ruling 3: a false rose hides the agent's involvement (the harmful
    // error), a false teal only under-credits the human (the safe one). It is
    // also what a share link without `su` means.
    const collection = beadAnchorsToGeoJson([poi("osm:node:1", [121.5, 25])], ["osm:node:1"]);
    expect(collection.features[0].properties?.prov).toBe("agent");
  });

  it("is empty when nothing is selected, so the calm map comes back", () => {
    expect(beadAnchorsToGeoJson([poi("osm:node:1", [121.5, 25])], []).features).toEqual([]);
  });

  it("ignores selected ids no loaded category has", () => {
    // A tool can select an id before its file lands; an unplaceable id must
    // not become a bead at [0, 0].
    expect(beadAnchorsToGeoJson([poi("osm:node:1", [121.5, 25])], ["osm:node:9"]).features).toEqual(
      [],
    );
  });
});

describe("selectionProvenance", () => {
  it("reads the store's record when it is there", () => {
    expect(selectionProvenance({ selectionSources: { a: "user" } })).toEqual({ a: "user" });
  });

  it("hands back the store's own object, not a copy of it", () => {
    // This is a zustand selector (`MarkerStatus`, and the map's own read): a
    // fresh object per read compares unequal to the last one on every store
    // write, and the subscriber re-renders forever. The identity IS the
    // "nothing changed" signal.
    const sources = { a: "user" } as const;
    expect(selectionProvenance({ selectionSources: sources })).toBe(sources);
  });

  it("says nothing about an id nobody claimed", () => {
    // What must never happen is the UI inventing a provenance the store never
    // recorded: an unrecorded id has no entry, and the bead layer's own
    // default (teal) is what decides how it is painted.
    expect(selectionProvenance({ selectionSources: {} })).toEqual({});
  });
});

describe("the browse layer", () => {
  const cafes = [poi("osm:node:1", [121.5, 25]), poi("osm:node:2", [121.6, 25])];

  /** A bakery that also serves coffee — the dual tagging the pipeline emits. */
  const bakeryCafe: MapFeature = {
    ...poi("osm:node:9", [121.4, 25], "bakery"),
    properties: {
      id: "osm:node:9",
      name: "both",
      category: "bakery",
      categories: ["bakery", "cafe"],
      source: "osm",
    },
  };

  it("paints nothing at all until a human asks for a category", () => {
    // The calm-map law: nothing is on this map that was not acted on or
    // browse-invoked.
    expect(browsePointsToGeoJson(cafes, []).features).toEqual([]);
  });

  it("paints only the categories asked for", () => {
    const mixed = [...cafes, poi("osm:node:3", [121.7, 25], "bakery")];
    expect(browsePointsToGeoJson(mixed, ["cafe"]).features.map((f) => f.properties?.id)).toEqual([
      "osm:node:1",
      "osm:node:2",
    ]);
    expect(
      browsePointsToGeoJson(mixed, ["cafe", "bakery"]).features.map((f) => f.properties?.id),
    ).toEqual(["osm:node:1", "osm:node:2", "osm:node:3"]);
  });

  it("includes a dual-tagged place under either of its tags", () => {
    // A bakery that also serves coffee is tagged both ways in the pipeline;
    // browsing cafes has to find it, or the count under a numeral is wrong.
    expect(browsePointsToGeoJson([bakeryCafe], ["cafe"]).features).toHaveLength(1);
  });

  it("draws a dual-tagged place once when both of its tags are browsed", () => {
    // The count under a numeral is a count of *places*. Emitting the same shop
    // once per matching category would put two grains on one doorway and make
    // every cluster that contains it claim one place too many.
    const collection = browsePointsToGeoJson([bakeryCafe], ["cafe", "bakery"]);
    expect(collection.features).toHaveLength(1);
    // Painted as the kind that was asked for first, so the slot is the one the
    // human would name if you pointed at the dot.
    expect(collection.features[0].properties?.slot).toBe(0);
  });

  it("numbers each place with the browsed kind it was painted under", () => {
    // The slot is what makes "these all agree" decidable inside the style
    // (`smin === smax`), so a cluster can tell a numeral about one kind of
    // place from a numeral about a mixture. It is an index into the browsed
    // set, not into the 18 categories — the set is what the eye is comparing.
    const mixed = [...cafes, poi("osm:node:3", [121.7, 25], "bakery")];
    expect(
      browsePointsToGeoJson(mixed, ["bakery", "cafe"]).features.map((f) => f.properties?.slot),
    ).toEqual([1, 1, 0]);
  });

  it("leaves out the places that are already beads", () => {
    // Otherwise a selected cafe carries two marks and is counted twice: once
    // as a bead and once inside a grain cluster's numeral.
    expect(
      browsePointsToGeoJson(cafes, ["cafe"], ["osm:node:1"]).features.map((f) => f.properties?.id),
    ).toEqual(["osm:node:2"]);
  });
});

/**
 * The ink budget. A numeral is the loudest thing this map draws, so only the
 * K largest clusters in view get one and everything else stays texture.
 */
describe("countedClusterThreshold", () => {
  it("counts every cluster when there is room for all of them", () => {
    expect(countedClusterThreshold([40, 30, 20], 12, 5)).toBe(20);
  });

  it("stops at the K-th largest", () => {
    const counts = Array.from({ length: 20 }, (_, i) => 100 - i);
    // 100..81 are the twelve largest; the threshold is the twelfth, 89.
    expect(countedClusterThreshold(counts, 12, 5)).toBe(89);
    const counted = counts.filter((c) => c >= countedClusterThreshold(counts, 12, 5));
    expect(counted).toHaveLength(12);
  });

  it("never counts a cluster below the zoom band's minimum", () => {
    // At z12 a "5 places here" bead says nothing anybody wanted to know.
    expect(countedClusterThreshold([8, 6, 4], 12, 25)).toBe(Number.POSITIVE_INFINITY);
    expect(countedClusterThreshold([30, 8, 6], 12, 25)).toBe(30);
  });

  it("holds the budget through a tie instead of picking arbitrarily", () => {
    // Twenty clusters of exactly five have no "twelve largest". Supercluster
    // gives no stable order to invent one from, so the whole band stays
    // texture — a reproducible answer instead of an arbitrary claim that
    // twelve of them matter more.
    const counts = Array.from({ length: 20 }, () => 5);
    expect(countedClusterThreshold(counts, 12, 5)).toBe(Number.POSITIVE_INFINITY);
    const withOneBigger = [9, ...counts];
    expect(countedClusterThreshold(withOneBigger, 12, 5)).toBe(9);
  });

  it("is Infinity when there is nothing in view", () => {
    expect(countedClusterThreshold([], 12, 5)).toBe(Number.POSITIVE_INFINITY);
  });

  it("defaults to the design's K", () => {
    expect(BROWSE_BUDGET_K).toBe(12);
    const counts = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(countedClusterThreshold(counts, undefined, 0)).toBe(
      countedClusterThreshold(counts, BROWSE_BUDGET_K, 0),
    );
  });
});

describe("browseTierMinimum", () => {
  it("asks for a bigger cluster the further out the camera is", () => {
    // z12 = the whole city, z13 = a district, z15 = a street: five places is
    // noise at the first and the interesting number at the last.
    expect(browseTierMinimum(12)).toBe(BROWSE_TIER_MINIMUM.z12);
    expect(browseTierMinimum(12.9)).toBe(BROWSE_TIER_MINIMUM.z12);
    expect(browseTierMinimum(13)).toBe(BROWSE_TIER_MINIMUM.z13);
    expect(browseTierMinimum(14.9)).toBe(BROWSE_TIER_MINIMUM.z13);
    expect(browseTierMinimum(15)).toBe(BROWSE_TIER_MINIMUM.z15);
    expect(browseTierMinimum(18)).toBe(BROWSE_TIER_MINIMUM.z15);
  });

  it("is the design's 25 / 10 / 5", () => {
    expect([BROWSE_TIER_MINIMUM.z12, BROWSE_TIER_MINIMUM.z13, BROWSE_TIER_MINIMUM.z15]).toEqual([
      25, 10, 5,
    ]);
  });
});

describe("the browse filters", () => {
  it("are complementary, so every browse feature is drawn exactly once", () => {
    // The budget is measured by querying both layers at once. If a cluster
    // could fall through both filters the measurement would miss it, and the
    // threshold would oscillate as clusters appeared and vanished.
    const grain = JSON.stringify(browseGrainFilter(30));
    const bead = JSON.stringify(browseBeadFilter(30));
    expect(grain).toContain('["<",["get","point_count"],30]');
    expect(bead).toContain('[">=",["get","point_count"],30]');
    expect(grain).toContain('["!",["has","point_count"]]');
  });

  it("turns every numeral off when the budget reaches nothing", () => {
    // `JSON.stringify(Infinity)` is `null`, and a filter is JSON — so the
    // "nothing counted" state has to cross into the style as a real number.
    const bead = JSON.stringify(browseBeadFilter(Number.POSITIVE_INFINITY));
    expect(bead).not.toContain("null");
    expect(bead).toContain("1000000000");
  });
});

describe("the bead layers", () => {
  it("cluster at the design's collision radius and split before street zoom", () => {
    const spec = beadSourceSpec();
    expect(spec.cluster).toBe(true);
    expect(spec.clusterRadius).toBe(CLUSTER_RADIUS_PX);
    expect(CLUSTER_RADIUS_PX).toBe(30);
    // "Zoom in and they separate" has to be literally true somewhere.
    expect(spec.clusterMaxZoom).toBe(CLUSTER_MAX_ZOOM);
    expect(browseSourceSpec().clusterMaxZoom).toBe(CLUSTER_MAX_ZOOM);
  });

  it("counts how many of a cluster's members the human selected", () => {
    // The count is what makes mixed-vs-uniform decidable in the style itself.
    expect(JSON.stringify(beadSourceSpec().clusterProperties)).toContain('["get","prov"]');
  });

  it("tints a mixed cluster teal", () => {
    // Ruling 3, in one expression: rose only when *every* member is the
    // human's. Anything else is teal, because a false rose would hide that an
    // agent selected some of what is inside.
    const icon = JSON.stringify(layoutOf(BEAD_CLUSTER_LAYER)["icon-image"]);
    expect(icon).toBe(
      JSON.stringify([
        "case",
        ["==", ["get", "user"], ["get", "point_count"]],
        beadImageId("cluster", "user"),
        beadImageId("cluster", "agent"),
      ]),
    );
  });

  it("never lets MapLibre hide a mark it decided was in the way", () => {
    // Overlap is resolved by coalescing, not by dropping: a bead MapLibre
    // silently skipped would make "I selected these 42" a claim about a map
    // nobody can see.
    for (const id of [BEAD_LAYER, BEAD_CLUSTER_LAYER, BROWSE_BEAD_LAYER]) {
      expect(layoutOf(id)["icon-allow-overlap"]).toBe(true);
      expect(layoutOf(id)["icon-ignore-placement"]).toBe(true);
    }
  });

  it("scales the sprite instead of baking one image per size", () => {
    // `icon-size` is a ratio of the baked radius, so the bead is the same
    // drawing at every zoom and the atlas holds six images, not sixty.
    const size = layoutOf(BEAD_LAYER)["icon-size"] as unknown[];
    expect(size.slice(0, 3)).toEqual(["interpolate", ["linear"], ["zoom"]]);
    expect(size[4]).toBeCloseTo(BEAD_RADIUS[0] / BEAD_BAKE_RADIUS);
    expect(size[6]).toBeCloseTo(BEAD_RADIUS[1] / BEAD_BAKE_RADIUS);
    expect(size[8]).toBeCloseTo(BEAD_RADIUS[2] / BEAD_BAKE_RADIUS);
    expect(Math.max(...BEAD_RADIUS)).toBeLessThanOrEqual(BEAD_BAKE_RADIUS);
  });

  it("grows a cluster bead with the log of its count, and then stops", () => {
    // Doubling a cluster has to be visible; a 400-place cluster must not eat
    // the screen. The cap is also why the bake radius is enough.
    const size = JSON.stringify(layoutOf(BEAD_CLUSTER_LAYER)["icon-size"]);
    expect(size).toContain('["ln",["get","point_count"]]');
    expect(size).toContain('["min",15');
  });

  it("puts the numeral on the cluster beads and nowhere else", () => {
    expect(layoutOf(BEAD_CLUSTER_LAYER)["text-field"]).toEqual(["get", "point_count_abbreviated"]);
    expect(layoutOf(BROWSE_BEAD_LAYER)["text-field"]).toEqual(["get", "point_count_abbreviated"]);
    expect(layoutOf(BEAD_LAYER)["text-field"]).toBeUndefined();
  });

  it("never sets a numeral below the mockup's 10px floor", () => {
    // A count set at 8px inside a 13px pearl stops being a number and becomes
    // grain — and unlike a grain it has already spent one of the twelve slots
    // in the ink budget. The smallest cluster either layer can be asked to
    // letter is the zoom band's minimum (5 places) and, for a selection that
    // clusters at all, a pair; both land under the floor without it.
    const browseSize = layoutOf(BROWSE_BEAD_LAYER)["text-size"];
    const selectionSize = layoutOf(BEAD_CLUSTER_LAYER)["text-size"];
    expect(sizeFor(browseSize, 5)).toBe(10);
    expect(sizeFor(selectionSize, 2)).toBe(10);
    // A floor, not a fixed size: the numeral still grows with the count.
    expect(sizeFor(browseSize, 400)).toBeGreaterThan(10);
  });

  it("draws browse under selection: acted-on outranks looked-at", () => {
    const ids = buildBeadLayerSpecs().map((l) => l.id);
    expect(ids).toEqual([BROWSE_GRAIN_LAYER, BROWSE_BEAD_LAYER, BEAD_LAYER, BEAD_CLUSTER_LAYER]);
    // The second half is the click contract the POI dot used to carry: what
    // you can see is what you can act on. `BEAD_LAYER_IDS` is the exact list
    // MapCanvas hands to `map.on("click", ...)`, so a fifth bead layer that
    // forgot to join it would be an unclickable mark — and this fails. That
    // the handler then does the right thing is a browser fact (T-85).
    expect([...BEAD_LAYER_IDS]).toEqual(ids);
  });

  it("paints the browse grains in the human's rose, whatever they hold", () => {
    // Browsing is something a person did, so its ink is the human's — the same
    // colour a hand-drawn shape uses. The grain field stays one colour even
    // with three categories painted: it is texture, and texture claims nothing
    // about being one kind of place. Only a numeral makes that claim.
    expect(paintOf(BROWSE_GRAIN_LAYER)["circle-color"]).toBe("#c2255c");
  });

  it("counts whether a browse cluster holds one kind of place or several", () => {
    // The lowest and the highest browsed slot inside the cluster: equal means
    // every place under the numeral is the same kind. Aggregated by the source
    // because a cluster's colour is a claim about all of its members, and
    // because these two survive a person adding a category — the properties
    // never mention which categories are browsed, only which slot each place
    // was painted under.
    const properties = JSON.stringify(browseSourceSpec().clusterProperties);
    expect(properties).toContain('"smin":["min",["get","slot"]]');
    expect(properties).toContain('"smax":["max",["get","slot"]]');
  });

  it("tints a browse cluster of mixed kinds teal", () => {
    // mixed-cluster=teal, on the axis multi-category browsing added. A numeral
    // on rose reads as "38 of the thing you asked for"; with three kinds
    // painted at once that sentence is only true while the 38 agree, and teal
    // is this map's existing word for a mark that is not one clean act. Ruling
    // 3's direction holds: under-claiming is the safe error.
    const icon = JSON.stringify(layoutOf(BROWSE_BEAD_LAYER)["icon-image"]);
    expect(icon).toBe(
      JSON.stringify([
        "case",
        ["==", ["get", "smin"], ["get", "smax"]],
        beadImageId("cluster", "user"),
        beadImageId("cluster", "agent"),
      ]),
    );
  });

  it("grades a grain that stands for a cluster by how many it stands for", () => {
    // The texture carries the density even where the budget refused a numeral.
    const radius = JSON.stringify(paintOf(BROWSE_GRAIN_LAYER)["circle-radius"]);
    expect(radius).toContain('["ln",["get","point_count"]]');
    const opacity = JSON.stringify(paintOf(BROWSE_GRAIN_LAYER)["circle-opacity"]);
    expect(opacity).toContain('["min",0.75');
  });

  it("keeps the glow inside the colour-law amendment", () => {
    expect(GLOW_ALPHA).toBeLessThanOrEqual(0.55);
  });
});

/**
 * The one failure mode a layer spec can have that nothing else catches.
 *
 * `map.addLayer` does NOT throw on an invalid layer: MapLibre validates, fires
 * an `error` event and skips it. The browse grains shipped once like that —
 * every other layer present, that one silently missing, no exception, no
 * failing test, and the map merely quiet. The rule it broke is that `["zoom"]`
 * may only be the input of a top-level `interpolate`/`step`; it was nested
 * inside a `["case"]`.
 *
 * Checked over every layer GlassMap adds, not just the bead ones: the trap is
 * the file's, not the layer's. That means all three builders `MapCanvas` calls
 * — `buildLayerSpecs`, `buildBeadLayerSpecs`, `buildDrawingLayerSpecs`; a
 * fourth one has to be added to the list below or it ships unchecked.
 *
 * The walk inspects `paint` and `layout` only. MapLibre's `filterSpec` takes
 * `zoom` as a parameter too, under the same top-level rule, so a filter could
 * in principle break the same way — none of GlassMap's do (every filter here
 * is a `point_count` test with a number baked in by the budget pass), and the
 * next one that reaches for `["zoom"]` has to widen this walk.
 */
describe("layer specs MapLibre will actually accept", () => {
  const usesZoom = (value: unknown): boolean =>
    Array.isArray(value) && (value[0] === "zoom" || value.some(usesZoom));

  const zoomIsTopLevel = (value: unknown): boolean => {
    if (!usesZoom(value)) return true;
    if (!Array.isArray(value)) return false;
    if (value[0] !== "interpolate" && value[0] !== "step") return false;
    const inputAt = value[0] === "interpolate" ? 2 : 1;
    const input = value[inputAt];
    const stops = value.filter((_, i) => i !== inputAt);
    return Array.isArray(input) && input[0] === "zoom" && !stops.some(usesZoom);
  };

  it("never nests a zoom expression inside another expression", () => {
    const specs = [
      ...buildLayerSpecs(),
      ...buildBeadLayerSpecs(),
      ...buildDrawingLayerSpecs(),
    ] as {
      id: string;
      paint?: Record<string, unknown>;
      layout?: Record<string, unknown>;
    }[];
    expect(specs.length).toBeGreaterThan(10);
    for (const spec of specs) {
      for (const block of [spec.paint, spec.layout]) {
        for (const [property, value] of Object.entries(block ?? {})) {
          expect(`${spec.id}.${property}: ${zoomIsTopLevel(value)}`).toBe(
            `${spec.id}.${property}: true`,
          );
        }
      }
    }
  });

  it("catches the shape that actually shipped broken", () => {
    // The test above only bites if the checker can fail. This is the exact
    // expression the browse grains had.
    const broken = [
      "case",
      ["has", "point_count"],
      4,
      ["interpolate", ["linear"], ["zoom"], 13, 2.6, 15, 4.2],
    ];
    expect(zoomIsTopLevel(broken)).toBe(false);
    expect(zoomIsTopLevel(["interpolate", ["linear"], ["zoom"], 13, 2.6, 15, 4.2])).toBe(true);
    expect(zoomIsTopLevel(4)).toBe(true);
  });
});
