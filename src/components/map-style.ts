import type { AddLayerObject } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { DATASETS, FEATURE_CATEGORIES, type FeatureCategory, type GlassMapFeature } from "@/lib/data/schema";
import type { MapFeature } from "@/lib/store/tier2";
import { BEAD_BAKE_RADIUS, beadImageId, type Provenance } from "./bead-sprite";
import { anchorPosition } from "./bead-style";

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
 * are written untyped and validated by MapLibre at runtime.
 *
 * That validation does NOT throw, as this comment used to claim: `addLayer`
 * fires an `error` event and **skips the layer**, leaving a map that is merely
 * missing something. A nested `["zoom"]` cost the browse grains exactly that
 * way during T-81, so `bead-style.test.ts` walks every spec here for the
 * shapes MapLibre rejects.
 */
const asLayer = (spec: object) => spec as AddLayerObject;

/** The paint block of a layer spec, for tests that assert the ramp. */
export const paintOf = (layer: AddLayerObject): Record<string, unknown> =>
  (layer as { paint?: Record<string, unknown> }).paint ?? {};

/** z<=13 point treatment: the "calm" ramp the landing view is designed around. */
export const CALM_RADIUS = 2;
export const CALM_OPACITY = 0.55;
export const CALM_STROKE_WIDTH = 0.5;

/**
 * Selected point sizes in screen pixels, at zoom 10 / 13 / 16.
 *
 * Shared by the bundled categories' `sel` branch and the materialised POI dot
 * so that "selected" is one size on this map, whichever tier the feature came
 * from: a person counting highlighted dots must not be able to tell a cafe
 * from a park by how big its highlight is.
 */
export const SELECTED_RADIUS = [6, 9, 12] as const;

/** Opacity of a selected point. Unselected points fade to CALM_OPACITY at z<=13. */
export const SELECTED_OPACITY = 0.9;

/**
 * Station and listing names only from z14. Below that they printed over every
 * dot in the frame, which is what made the zoomed-out map unreadable.
 */
export const LABEL_MINZOOM = 14;

/**
 * One point per selected **bundled** feature, feeding the selection ring. Kept
 * in its own source rather than filtering the category sources: a symbol drawn
 * from a polygon source lands on every vertex, so a park would get a ring per
 * corner.
 *
 * Selected points of interest are deliberately absent — the halo split (design
 * round 2, §8.1 row 3). A POI has no category colour to ring, so it is drawn as
 * a bead instead (`BEAD_SOURCE`), and the bead's own rim and glow already say
 * everything a ring would. Ringing it too would put two marks on one place and
 * would give a clustered bead a stack of loose rings underneath it — exactly
 * the pile of dots the bead system exists to remove.
 */
export const SELECTION_SOURCE = "gm-src-selection";

/** The one layer drawn from it. */
export const SELECTION_RING_LAYER = "gm-selection-ring";

/**
 * Ring size in screen pixels at z10 and z16; grows a little with the zoom,
 * like the dots. The same span the two-layer halo interpolated over.
 */
const RING_RADIUS = [7, 11] as const;

const POINTS = ["==", ["geometry-type"], "Point"];
const AREAS = ["!=", ["geometry-type"], "Point"];

/**
 * The feature-state key that carries "this one is selected". MapCanvas is the
 * only writer (`map.setFeatureState`); nothing else puts state on a feature.
 */
export const SELECTED_STATE = "selected";

/**
 * The GeoJSON source every category renders from.
 *
 * `promoteId` is what makes the selected look possible at all: a GeoJSON
 * feature has no id of its own, and `map.setFeatureState` addresses a feature
 * by *feature id*, never by a property. Promoting `properties.id` — the same
 * id tools and `store.selection` use — makes the two sides speak one language.
 */
export const categorySourceSpec = (): {
  type: "geojson";
  data: FeatureCollection;
  promoteId: string;
} => ({
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
  promoteId: "id",
});

/**
 * Which category source holds each feature, by id. Feature state is stored per
 * source, so an id in `store.selection` cannot be marked until we know which
 * of the six sources to mark it on.
 *
 * Tier-2 ids are deliberately absent. POIs render out of BEAD_SOURCE, whose
 * paint reads no feature state at all, so listing them here would write state
 * that nothing reads — and would make `syncSelectionState` believe it had
 * highlighted a feature by a mechanism that is not the one doing the work.
 */
export function featureSourceIndex(features: readonly GlassMapFeature[]): Map<string, string> {
  return new Map(features.map((f) => [f.properties.id, sourceId(f.properties.category)]));
}

/**
 * The selected tier-2 features — everything the bead source is allowed to
 * contain. Membership *is* selection: a POI is in it only while it is
 * selected, so the bead cannot drift out of step with the store the way a
 * `setData`-then-`setFeatureState` pair can, and deselecting empties it and
 * gives the calm map back.
 *
 * Selection order is not preserved (the store's is), which costs nothing: the
 * result is only ever drawn, never listed. Scanning the tier-2 slice rather
 * than indexing it keeps this a function of two arrays with no cache to go
 * stale, and it runs on selection changes only.
 */
export function selectedPoiFeatures(
  tier2: readonly MapFeature[],
  selection: readonly string[],
): MapFeature[] {
  if (selection.length === 0 || tier2.length === 0) return [];
  const wanted = new Set(selection);
  return tier2.filter((f) => wanted.has(f.properties.id));
}

/** How `map.setFeatureState` / `map.removeFeatureState` address one feature. */
export type FeatureStateTarget = { source: string; id: string };

/**
 * Move the map's selected-feature state to `selection`, and report what is
 * flagged afterwards as id -> source (the shape to pass back in as `applied`).
 *
 * Only the ids whose membership changed are touched. Clearing everything and
 * re-setting everything would put the whole selection through MapLibre's paint
 * -array update on each keystroke of a refinement, which is the cost this
 * mechanism exists to avoid.
 *
 * Ids the store has selected but no dataset has yet are skipped: `featureSources`
 * only knows the features that are loaded, and feature state cannot be written
 * without a source to write it to. A later call picks them up.
 *
 * `reapply` re-states every addressable selected id even if it was already
 * flagged. It is for the moment new feature data lands: `setData` reloads the
 * source's tiles, which ids are even addressable changes with the data, and
 * whether the reload keeps the previously applied state is MapLibre's internal
 * business - not something the highlight should depend on.
 *
 * Written as a plain function over two callbacks so the diff can be tested
 * without a live map (the map never loads under the network-isolated e2e run).
 */
export function syncSelectionState(args: {
  selection: readonly string[];
  /** What the map currently has flagged, id -> source. */
  applied: ReadonlyMap<string, string>;
  /** Every feature the store has loaded, id -> source; see `featureSourceIndex`. */
  featureSources: ReadonlyMap<string, string>;
  reapply?: boolean;
  setFeatureState: (target: FeatureStateTarget, state: Record<string, boolean>) => void;
  removeFeatureState: (target: FeatureStateTarget, key: string) => void;
}): Map<string, string> {
  const { selection, applied, featureSources, reapply = false } = args;
  const next = new Map<string, string>();
  for (const id of selection) {
    const source = featureSources.get(id);
    if (source) next.set(id, source);
  }
  for (const [id, source] of applied) {
    // Only our own key: `removeFeatureState` without one would drop any other
    // state a future feature might carry.
    if (next.get(id) !== source) args.removeFeatureState({ source, id }, SELECTED_STATE);
  }
  for (const [id, source] of next) {
    if (reapply || applied.get(id) !== source) {
      args.setFeatureState({ source, id }, { [SELECTED_STATE]: true });
    }
  }
  return next;
}

/**
 * `true` for features the map currently has marked as selected.
 *
 * Read from feature state rather than from the ids themselves. The previous
 * form, `["in", ["get","id"], ["literal", selection]]`, made MapLibre scan the
 * id array once per feature per evaluation pass — O(features x selected) — and
 * the whole paint array was re-evaluated on every selection change because the
 * expression itself changed. A feature-state lookup is O(1), the expressions
 * are constant, and only the features whose state actually changed are
 * re-uploaded (see `ProgramConfiguration.updatePaintArrays`).
 */
const sel = ["boolean", ["feature-state", SELECTED_STATE], false];

/**
 * Every layer GlassMap adds on top of the basemap, in draw order.
 * Built once, at `map.load`: the selected look is driven by feature state, so
 * no layer or paint property ever has to be rewritten when the selection moves.
 */
export function buildLayerSpecs(): AddLayerObject[] {
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
    const opaque = category === "listing" ? 0.6 : SELECTED_OPACITY;
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
            ["case", sel, SELECTED_RADIUS[0], CALM_RADIUS],
            13,
            ["case", sel, SELECTED_RADIUS[1], CALM_RADIUS],
            16,
            ["case", sel, SELECTED_RADIUS[2], 6],
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

  // The selection ring, on top of everything else GlassMap draws: the bead's
  // glow and deep rim around a transparent core, so the category colour the
  // legend promises still shows through. One sprite replaces the two circle
  // layers the white-cased teal halo needed — a circle layer has one stroke,
  // and the casing and the ring were a stroke each. The white is still there,
  // baked into the sprite: it is what keeps the ring readable over a dark park
  // fill as well as over pale streets.
  specs.push(
    asLayer({
      id: SELECTION_RING_LAYER,
      type: "symbol",
      source: SELECTION_SOURCE,
      layout: {
        "icon-image": [
          "case",
          ["==", ["get", "prov"], "user"],
          beadImageId("ring", "user"),
          beadImageId("ring", "agent"),
        ],
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          RING_RADIUS[0] / BEAD_BAKE_RADIUS,
          16,
          RING_RADIUS[1] / BEAD_BAKE_RADIUS,
        ],
        // A ring that MapLibre decided to hide would leave a selected feature
        // looking unselected.
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    }),
  );

  return specs;
}

/** All a ring anchor needs: an id to match on and a geometry to average. */
type AnchorFeature = { geometry: Geometry | null; properties: { id: string } };

/**
 * Where each selected **bundled** feature's ring goes: the average of the
 * feature's own coordinates, which is the anchor rule labelled drawings
 * already use (`labelPointsToGeoJson`). Unknown ids contribute nothing — a
 * tool can select an id before the datasets have finished loading, and an
 * unplaceable id must not become a ring at [0, 0].
 *
 * Selected points of interest are not in here and never will be: that is the
 * halo split. They are beads (`beadAnchorsToGeoJson`), and a bead already
 * carries the rim and the glow a ring would have added.
 *
 * The points carry a provenance and deliberately no `id`: the ring layer is
 * hit by clicks like every other bead layer, and a ring must not become a
 * second, invisible way to toggle the feature underneath it.
 */
export function selectionAnchorsToGeoJson(
  features: readonly AnchorFeature[],
  selection: readonly string[],
  sources: Readonly<Record<string, Provenance>> = {},
): FeatureCollection {
  const byId = new Map<string, AnchorFeature>();
  for (const feature of features) byId.set(feature.properties.id, feature);
  const out: Feature[] = [];
  for (const id of selection) {
    const at = anchorPosition(byId.get(id)?.geometry ?? null);
    if (!at) continue;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: at },
      // Teal unless the store recorded a human: Ruling 3's safe direction.
      properties: { prov: sources[id] ?? "agent" },
    });
  }
  return { type: "FeatureCollection", features: out };
}

/**
 * Layer ids that respond to clicks and show a pointer cursor: the bundled data
 * layers only. Labels are excluded so a click never lands on text instead of
 * the thing it names, and the selection ring is excluded because its anchors
 * carry no feature id — hovering one showed a pointer that promised a
 * selection the click could not make.
 *
 * The bead layers answer to clicks too, through `BEAD_LAYER_IDS`; they are a
 * separate list because a click on a bead can also mean "this is a cluster,
 * split it", which no bundled dot can mean.
 */
export const INTERACTIVE_LAYER_IDS = buildLayerSpecs()
  .filter((l) => l.type !== "symbol" && "source" in l && l.source !== SELECTION_SOURCE)
  .map((l) => l.id);
