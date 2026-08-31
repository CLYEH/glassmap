import type { AddLayerObject, Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { featureCategories, type MapFeature, type Tier2Category } from "@/lib/store/tier2";
import { BEAD_BAKE_RADIUS, beadImageId, type Provenance } from "./bead-sprite";
import { DRAWING_COLOR, positionsOf } from "./drawing-style";

/**
 * The bead layers: what a selected place and a browsed category look like.
 *
 * Two clustered GeoJSON sources, four layers, six sprites. Both sources are
 * empty at rest — the calm map is the steady state, and everything here is
 * either something an agent acted on or something a human asked to browse.
 */

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

const asLayer = (spec: object) => spec as AddLayerObject;

/** The selected places, one point each, clustered. */
export const BEAD_SOURCE = "gm-src-bead";

/** The categories a human is browsing, clustered. Empty unless they asked. */
export const BROWSE_SOURCE = "gm-src-browse";

export const BEAD_LAYER = "gm-bead";
export const BEAD_CLUSTER_LAYER = "gm-bead-cluster";
export const BROWSE_GRAIN_LAYER = "gm-browse-grain";
export const BROWSE_BEAD_LAYER = "gm-browse-bead";

/**
 * Every bead layer, in draw order. Clicks and the pointer cursor are wired to
 * all four: a bead is the thing you can see, so it is the thing you can act on
 * (single -> toggle its selection, cluster -> zoom until it splits).
 */
export const BEAD_LAYER_IDS = [
  BROWSE_GRAIN_LAYER,
  BROWSE_BEAD_LAYER,
  BEAD_LAYER,
  BEAD_CLUSTER_LAYER,
] as const;

/**
 * How close two marks have to be, in screen pixels, before they coalesce into
 * one counted bead. Thirty is roughly two bead diameters: below it the rims
 * overlap and the map turns into the stack of dots this system replaces.
 */
export const CLUSTER_RADIUS_PX = 30;

/**
 * Above this zoom nothing clusters. The cluster popover's promise is "zoom in
 * and they separate", so there has to be a zoom at which that is literally
 * true — z17 is one street, which is as far as the promise needs to hold.
 */
export const CLUSTER_MAX_ZOOM = 16;

/**
 * The ink budget: at most twelve counted beads on screen at once. A numeral is
 * the loudest thing this map draws, so the twelve largest clusters get one and
 * everything else stays texture. See `countedClusterThreshold`.
 */
export const BROWSE_BUDGET_K = 12;

/**
 * The smallest cluster that may carry a numeral, by zoom band. Zoomed out, a
 * "5 cafes here" bead says nothing a human wanted to know; zoomed in, five IS
 * the interesting number. Bands are z<13 / z<15 / the rest, the three stages
 * the design was drawn at.
 */
export const BROWSE_TIER_MINIMUM = { z12: 25, z13: 10, z15: 5 } as const;

export function browseTierMinimum(zoom: number): number {
  if (zoom < 13) return BROWSE_TIER_MINIMUM.z12;
  if (zoom < 15) return BROWSE_TIER_MINIMUM.z13;
  return BROWSE_TIER_MINIMUM.z15;
}

/**
 * The `point_count` at which a browse cluster earns a numeral: the lowest
 * count among the K largest clusters in view, never below the zoom band's
 * minimum. `Infinity` means nothing in view qualifies.
 *
 * Ties are resolved *down*, not by array order: if admitting every cluster of
 * size n would push the count past K, none of them get a numeral and the
 * threshold stops above them. Picking twelve of twenty identical clusters
 * would be an arbitrary claim that those twelve matter more, and supercluster
 * gives no stable order to make it from — whereas "the budget bit, so this
 * whole band stays texture" is true and reproducible.
 */
export function countedClusterThreshold(
  counts: readonly number[],
  k = BROWSE_BUDGET_K,
  tierMinimum = 0,
): number {
  const sizes = new Map<number, number>();
  for (const count of counts) {
    if (count < tierMinimum) continue;
    sizes.set(count, (sizes.get(count) ?? 0) + 1);
  }
  let threshold = Number.POSITIVE_INFINITY;
  let taken = 0;
  for (const value of [...sizes.keys()].sort((a, b) => b - a)) {
    taken += sizes.get(value)!;
    if (taken > k) break;
    threshold = value;
  }
  return threshold;
}

/**
 * A threshold no `point_count` can reach. MapLibre filters are JSON, and
 * `JSON.stringify(Infinity)` is `null`, so the "nothing counted" state has to
 * cross into the style as a finite number.
 */
const BUDGET_NONE = 1e9;

const finite = (threshold: number) => (Number.isFinite(threshold) ? threshold : BUDGET_NONE);

const IS_CLUSTER = ["has", "point_count"];

/**
 * MapLibre does not export the style-spec expression types (same reason
 * `asLayer` exists in map-style.ts), so a filter is written untyped and read
 * back through the one signature that does name the type.
 */
type StyleFilter = NonNullable<Parameters<MapLibreMap["setFilter"]>[1]>;

const asFilter = (expression: unknown[]) => expression as unknown as StyleFilter;

/** Grains: every unclustered place, plus every cluster the budget did not reach. */
export const browseGrainFilter = (threshold: number) =>
  asFilter(["any", ["!", IS_CLUSTER], ["<", ["get", "point_count"], finite(threshold)]]);

/** Counted beads: the clusters that fit the budget. */
export const browseBeadFilter = (threshold: number) =>
  asFilter(["all", IS_CLUSTER, [">=", ["get", "point_count"], finite(threshold)]]);

/**
 * A radius that grows with the log of a count and then stops: doubling a
 * cluster must be visible, and a 400-place cluster must not eat the screen.
 */
interface LogRamp {
  base: number;
  slope: number;
  cap: number;
}

const logRampExpr = (ramp: LogRamp) => [
  "min",
  ramp.cap,
  ["+", ramp.base, ["*", ramp.slope, ["ln", ["get", "point_count"]]]],
];

/** Selection cluster beads: the loudest mark on the map, so the biggest ramp. */
export const SELECTION_CLUSTER_RAMP: LogRamp = { base: 9, slope: 1.6, cap: 15 };

/** Browse cluster beads: a shade smaller — browsing is quieter than selecting. */
export const BROWSE_CLUSTER_RAMP: LogRamp = { base: 6.5, slope: 1.8, cap: 15 };

/** Grains that stand for a cluster: the texture carries the density. */
export const BROWSE_GRAIN_RAMP: LogRamp = { base: 2.8, slope: 1.15, cap: 6.8 };

/** A grain standing for one place, at district zoom and at street zoom. */
const GRAIN_RADIUS = { z13: 2.6, z15: 4.2 } as const;

/**
 * A single bead's radius, at zoom 10 / 13 / 16.
 *
 * It tracks the bundled selected dot (`SELECTED_RADIUS`, 6/9/12) but flattens
 * both ends: below 7 px the 2 px rim that carries provenance degenerates into
 * a hairline, and above 11 px a lone bead starts to outweigh the counted
 * cluster beside it.
 */
export const BEAD_RADIUS = [7, 9, 11] as const;

/** `icon-size` is a multiple of the baked sprite, so every size is a ratio. */
const iconScale = (radius: number) => radius / BEAD_BAKE_RADIUS;

const beadIconSize = [
  "interpolate",
  ["linear"],
  ["zoom"],
  10,
  iconScale(BEAD_RADIUS[0]),
  13,
  iconScale(BEAD_RADIUS[1]),
  16,
  iconScale(BEAD_RADIUS[2]),
];

const clusterIconSize = (ramp: LogRamp) => ["/", logRampExpr(ramp), BEAD_BAKE_RADIUS];

/** The numeral inside a counted bead: dark ink on the pearl, no halo needed. */
const COUNT_COLOR = "#17202a";

/**
 * The smallest a numeral may be set, from the mockup's `Math.max(10, ...)`.
 * Below 10 px a two-digit count on a pearl stops being a number and becomes
 * grain — and a numeral nobody can read is worse than the texture it replaced,
 * because it still spends the ink budget.
 */
const COUNT_MIN_SIZE = 10;

/**
 * Deviation from the mockup, declared rather than hidden: the mockup sets the
 * numeral in a heavier face. Every label GlassMap draws asks the basemap's
 * glyph endpoint for `Noto Sans Regular` (see `map-style.ts` and
 * `drawing-style.ts`), and a fontstack that endpoint does not serve drops the
 * label entirely — a silent failure exactly like the one the layer-spec test
 * exists for. One stack, everywhere, until a heavier one is verified live.
 */
const countLabel = (ramp: LogRamp) => ({
  "text-field": ["get", "point_count_abbreviated"],
  "text-font": ["Noto Sans Regular"],
  "text-size": ["max", COUNT_MIN_SIZE, ["*", 0.82, logRampExpr(ramp)]],
  "text-allow-overlap": true,
  "text-ignore-placement": true,
});

/**
 * Symbols never collide: the whole point of clustering is that overlap is
 * resolved by coalescing, not by MapLibre silently dropping marks. A hidden
 * bead would make "I selected these 42" a lie about a map nobody can see.
 */
const NEVER_HIDE = { "icon-allow-overlap": true, "icon-ignore-placement": true };

/**
 * The bead source. `prov` rides every point so a cluster can count how many of
 * its members are the human's: `user === point_count` is an all-human cluster,
 * anything else is teal. That asymmetry is Ruling 3 — a false rose would hide
 * the agent's involvement, a false teal only under-credits the human.
 */
export const beadSourceSpec = () => ({
  type: "geojson" as const,
  data: EMPTY,
  cluster: true,
  clusterRadius: CLUSTER_RADIUS_PX,
  clusterMaxZoom: CLUSTER_MAX_ZOOM,
  clusterProperties: {
    user: ["+", ["case", ["==", ["get", "prov"], "user"], 1, 0]],
  },
});

/**
 * The name of the browsed-category slot a browse point was painted under: its
 * index in the browsed set, 0-based. Not the category itself, because what the
 * style has to decide is only ever "do these agree?", and a number the source
 * can take a min and a max of answers that without the cluster properties
 * having to be rebuilt every time a person taps a chip.
 */
export const BROWSE_SLOT = "slot";

/**
 * The browse source. Browsing is a human act, so every mark from it is rose.
 *
 * `smin`/`smax` are the lowest and highest slot inside a cluster, which makes
 * "every place in here is the same kind" decidable in the style itself
 * (`smin === smax`) — the same trick the selection source plays with `user`
 * against `point_count`, for the same reason: a cluster's colour is a claim
 * about all of its members, so the style needs an aggregate rather than a
 * sample.
 */
export const browseSourceSpec = () => ({
  type: "geojson" as const,
  data: EMPTY,
  cluster: true,
  clusterRadius: CLUSTER_RADIUS_PX,
  clusterMaxZoom: CLUSTER_MAX_ZOOM,
  clusterProperties: {
    smin: ["min", ["get", BROWSE_SLOT]],
    smax: ["max", ["get", BROWSE_SLOT]],
  },
});

const beadIcon = (kind: "bead" | "cluster") => [
  "case",
  ["==", ["get", "prov"], "user"],
  beadImageId(kind, "user"),
  beadImageId(kind, "agent"),
];

const clusterIcon = [
  "case",
  ["==", ["get", "user"], ["get", "point_count"]],
  beadImageId("cluster", "user"),
  beadImageId("cluster", "agent"),
];

/**
 * A counted browse bead: rose while every place under the numeral is the same
 * kind, teal the moment two categories coalesce into it.
 *
 * The owner's mixed-cluster=teal ruling, applied to the axis multi-category
 * browsing added. A numeral is the loudest mark this map draws and it is read
 * as "38 of the thing you asked for"; with three categories painted at once,
 * on the rose that says "you asked for this", that sentence is only true while
 * the 38 agree. Teal is the map's existing word for "this mark is not one
 * person's single act", and Ruling 3 already settled which way to err: a mark
 * that under-claims is the safe error, a mark that over-claims is not.
 *
 * The grains keep their rose whatever they hold: the grain field is texture,
 * and texture makes no claim to be about one kind. The colour only moves where
 * a number is put on it.
 */
const browseClusterIcon = [
  "case",
  ["==", ["get", "smin"], ["get", "smax"]],
  beadImageId("cluster", "user"),
  beadImageId("cluster", "agent"),
];

/**
 * The bead layers, in draw order, above everything in `buildLayerSpecs()`.
 *
 * `threshold` is the browse ink budget at the moment the layers are built;
 * `moveend` moves it afterwards with `map.setFilter`. It starts at "nothing
 * counted" so a browse layer that is painted before the first budget pass
 * shows texture rather than a screenful of numerals.
 */
export function buildBeadLayerSpecs(threshold = Number.POSITIVE_INFINITY): AddLayerObject[] {
  return [
    asLayer({
      id: BROWSE_GRAIN_LAYER,
      type: "circle",
      source: BROWSE_SOURCE,
      filter: browseGrainFilter(threshold),
      paint: {
        "circle-color": DRAWING_COLOR.user,
        // A lone place is a small dot; a cluster too small for a numeral is a
        // bigger, denser one. Same ink, so the eye reads the whole field as
        // one texture and the counted beads as the exceptions.
        //
        // The zoom ramp is the OUTER expression and the cluster case is inside
        // each stop, not the other way round: MapLibre rejects a layer whose
        // `["zoom"]` is nested (`"zoom" expression may only be used as input to
        // a top-level "step" or "interpolate"`), and it rejects it by firing an
        // error event and skipping the layer — the browse grains simply were
        // not there. Same shape the category circles use for `["case", sel]`.
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          ["case", IS_CLUSTER, logRampExpr(BROWSE_GRAIN_RAMP), GRAIN_RADIUS.z13],
          15,
          ["case", IS_CLUSTER, logRampExpr(BROWSE_GRAIN_RAMP), GRAIN_RADIUS.z15],
        ],
        "circle-opacity": [
          "case",
          IS_CLUSTER,
          ["min", 0.75, ["+", 0.55, ["*", 0.04, ["ln", ["get", "point_count"]]]]],
          0.62,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.8,
      },
    }),
    asLayer({
      id: BROWSE_BEAD_LAYER,
      type: "symbol",
      source: BROWSE_SOURCE,
      filter: browseBeadFilter(threshold),
      layout: {
        "icon-image": browseClusterIcon,
        "icon-size": clusterIconSize(BROWSE_CLUSTER_RAMP),
        ...NEVER_HIDE,
        ...countLabel(BROWSE_CLUSTER_RAMP),
      },
      paint: { "text-color": COUNT_COLOR },
    }),
    asLayer({
      id: BEAD_LAYER,
      type: "symbol",
      source: BEAD_SOURCE,
      filter: ["!", IS_CLUSTER],
      layout: {
        "icon-image": beadIcon("bead"),
        "icon-size": beadIconSize,
        ...NEVER_HIDE,
      },
    }),
    asLayer({
      id: BEAD_CLUSTER_LAYER,
      type: "symbol",
      source: BEAD_SOURCE,
      filter: IS_CLUSTER,
      layout: {
        "icon-image": clusterIcon,
        "icon-size": clusterIconSize(SELECTION_CLUSTER_RAMP),
        ...NEVER_HIDE,
        ...countLabel(SELECTION_CLUSTER_RAMP),
      },
      paint: { "text-color": COUNT_COLOR },
    }),
  ];
}

/**
 * The store's record of who selected each id — "as recorded", never guessed.
 *
 * A one-field projection of the store rather than a direct `s.selectionSources`
 * read at each call site, because it is also the zustand *selector* two
 * components subscribe with: the identity it returns is the store's own object,
 * which changes only when a selection is written, so nothing re-renders on an
 * unrelated store write.
 *
 * An id with no entry is one nobody claimed, and `beadAnchorsToGeoJson` paints
 * it teal: the direction Ruling 3 made safe, since a false teal under-credits
 * the human while a false rose would hide the agent's involvement entirely.
 */
export function selectionProvenance(state: {
  selectionSources: Readonly<Record<string, Provenance>>;
}): Readonly<Record<string, Provenance>> {
  return state.selectionSources;
}

/** All a bead needs from a feature: an id to act on and a geometry to sit on. */
export type AnchorFeature = { geometry: Geometry | null; properties: { id: string } };

/**
 * Where a mark sits: the average of the feature's own coordinates — the same
 * anchor rule labelled drawings and selection rings use. Null when the feature
 * has no geometry to average, which a tool-selected id can have until the data
 * it named finishes loading.
 */
export function anchorPosition(geometry: Geometry | null): Position | null {
  if (!geometry) return null;
  const positions = positionsOf(geometry);
  if (positions.length === 0) return null;
  const sum = positions.reduce(([x, y], [lng, lat]) => [x + lng, y + lat], [0, 0]);
  return [sum[0] / positions.length, sum[1] / positions.length];
}

/**
 * One bead point per selected point of interest, in selection order.
 *
 * Clustering is why these are points and not the features themselves:
 * supercluster only takes points, and a bead marks a *place* — a POI that
 * happens to be mapped as a building outline gets one bead at its centre, not
 * a ring of them around its corners.
 *
 * `sources` is the store's record of who selected each id. An id it does not
 * name is teal, because that is the direction Ruling 3 made safe: over-crediting
 * the agent under-credits the human, while the opposite hides the agent
 * entirely. It is also what the share codec presumes when a link carries no
 * `su` key.
 */
export function beadAnchorsToGeoJson(
  poi: readonly AnchorFeature[],
  selection: readonly string[],
  sources: Readonly<Record<string, Provenance>> = {},
): FeatureCollection {
  if (selection.length === 0 || poi.length === 0) return { type: "FeatureCollection", features: [] };
  const byId = new Map(poi.map((feature) => [feature.properties.id, feature]));
  const features: Feature[] = [];
  for (const id of selection) {
    const feature = byId.get(id);
    if (!feature) continue;
    const at = anchorPosition(feature.geometry);
    if (!at) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: at },
      properties: { id, prov: sources[id] ?? "agent" },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Every loaded place in the browsed categories, minus the ones already
 * selected.
 *
 * The subtraction is what keeps a place from being drawn twice: a selected
 * cafe is a bead, and a bead is a stronger statement than a grain. Without it
 * the same cafe would carry both marks and the count under the numeral would
 * be wrong about how many places are still just "browsable".
 *
 * One point per *place*, never per category it matches: a bakery that also
 * serves coffee is one dot on the map whether the human is browsing bakeries,
 * cafes or both, or the numeral over it would count a single shop twice. The
 * `slot` it carries is the first browsed category it matches, in the order the
 * human asked for them — the kind it was painted under, which is all the style
 * needs to tell a cluster of one kind from a cluster of several.
 *
 * An empty category list means nobody is browsing, and the browse layer is
 * empty — the calm map, byte for byte.
 */
export function browsePointsToGeoJson(
  features: readonly MapFeature[],
  categories: readonly Tier2Category[],
  selection: readonly string[] = [],
): FeatureCollection {
  if (categories.length === 0) return { type: "FeatureCollection", features: [] };
  const selected = new Set(selection);
  const out: Feature[] = [];
  for (const feature of features) {
    const id = feature.properties.id;
    if (selected.has(id)) continue;
    const own = featureCategories(feature);
    const slot = categories.findIndex((category) => own.includes(category));
    if (slot < 0) continue;
    const at = anchorPosition(feature.geometry);
    if (!at) continue;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: at },
      properties: { id, [BROWSE_SLOT]: slot },
    });
  }
  return { type: "FeatureCollection", features: out };
}
