import type { GlassMapTool } from "@/lib/webmcp/types";
import type { LngLat, MapToolStore, MapView } from "@/lib/store/map-store";
import { FEATURE_CATEGORIES, type FeatureCategory, type GlassMapFeature } from "@/lib/data/schema";
import { describeState, SELECTION_ID_LIMIT } from "./state";
import {
  boundsIntersect,
  describeFeature,
  featureBounds,
  featureCenter,
  type FeatureOutput,
} from "./output";
import { resolvePlaceOne } from "./gazetteer";
import {
  DEFAULT_LIMIT,
  DEFAULT_RADIUS_M,
  MAX_LIMIT,
  queryFeatures,
  resolveNear,
  validateCategories,
  validateLimit,
  validateRadius,
} from "./query";

/** Zoom used when the caller names a place instead of a camera position. */
export const PLACE_ZOOM = 15;

/** Ceiling on an explicit id list; larger sets belong to the filter path. */
export const MAX_IDS = 100;

export interface SetMapViewInput {
  center?: { lng: number; lat: number };
  zoom?: number;
  bearing?: number;
  pitch?: number;
  place?: string;
  feature_id?: string;
}

export interface FindFeaturesInput {
  query?: unknown;
  categories?: unknown;
  near?: unknown;
  radius_m?: unknown;
  limit?: unknown;
  within?: unknown;
}

export interface ListFeaturesInViewInput {
  categories?: unknown;
  limit?: unknown;
}

export interface SelectFeaturesInput {
  ids?: unknown;
  query?: unknown;
  within?: unknown;
  near?: unknown;
  radius_m?: unknown;
  categories?: unknown;
  replace?: unknown;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Returns a validated patch, or an error message. Never throws. */
export function validateSetMapView(input: SetMapViewInput): { patch: Partial<MapView> } | { error: string } {
  const patch: Partial<MapView> = {};
  if (input.center !== undefined) {
    const { lng, lat } = input.center ?? {};
    if (!isNum(lng) || !isNum(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return { error: "center must be {lng:-180..180, lat:-90..90}" };
    }
    patch.center = [lng, lat];
  }
  if (input.zoom !== undefined) {
    if (!isNum(input.zoom) || input.zoom < 0 || input.zoom > 22) return { error: "zoom must be 0..22" };
    patch.zoom = input.zoom;
  }
  if (input.bearing !== undefined) {
    if (!isNum(input.bearing)) return { error: "bearing must be a number (degrees)" };
    patch.bearing = ((input.bearing % 360) + 360) % 360;
  }
  if (input.pitch !== undefined) {
    if (!isNum(input.pitch) || input.pitch < 0 || input.pitch > 85) return { error: "pitch must be 0..85" };
    patch.pitch = input.pitch;
  }
  if (Object.keys(patch).length === 0) return { error: "provide at least one of center, zoom, bearing, pitch" };
  return { patch };
}

// ---------------------------------------------------------------- schema bits

const categoriesProperty = {
  type: "array",
  minItems: 1,
  items: { type: "string", enum: [...FEATURE_CATEGORIES] },
  description: `Keep only features in these categories. Omit to search every category. Values: ${FEATURE_CATEGORIES.join(", ")}.`,
};

const limitProperty = {
  type: "integer",
  minimum: 1,
  maximum: MAX_LIMIT,
  description: `Maximum number of features to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}). The "total" field reports how many matched in all.`,
};

const nearProperty = {
  description:
    'Origin for distances and for the radius filter: a feature id returned by an earlier call (e.g. "osm:node:123"), a place name to look up in the loaded data (e.g. "Daan Station"), or an explicit coordinate. Omit to measure from the centre of the current view.',
  anyOf: [
    { type: "string", description: "A feature id, or the name of a station, park or district." },
    {
      type: "object",
      properties: {
        lng: { type: "number", minimum: -180, maximum: 180, description: "Longitude in degrees." },
        lat: { type: "number", minimum: -90, maximum: 90, description: "Latitude in degrees." },
      },
      required: ["lng", "lat"],
      additionalProperties: false,
      description: "Explicit coordinate.",
    },
  ],
};

const radiusProperty = {
  type: "number",
  exclusiveMinimum: 0,
  description: `Keep only features within this many metres of "near" (default ${DEFAULT_RADIUS_M} when "near" is given, no radius filter otherwise). Measured to a feature point, or to the centroid of an area.`,
};

// ------------------------------------------------------------------ internals

interface ResolvedQuery {
  origin: LngLat;
  radius_m?: number;
  categories?: FeatureCategory[];
  query?: string;
  limit: number;
}

type QueryError = { error: string; candidates?: unknown };

/**
 * Validation shared by find_features and select_features, so that "the parks I
 * found" and "the parks you selected" can never be different sets. Returns
 * either the resolved query or the exact object the tool should hand back.
 */
function resolveQueryInput(
  store: MapToolStore,
  input: FindFeaturesInput,
): ResolvedQuery | QueryError {
  const cats = validateCategories(input.categories);
  if ("error" in cats) return { error: cats.error };
  const lim = validateLimit(input.limit);
  if ("error" in lim) return { error: lim.error };
  const rad = validateRadius(input.radius_m);
  if ("error" in rad) return { error: rad.error };

  let query: string | undefined;
  if (input.query !== undefined) {
    if (typeof input.query !== "string") return { error: "query must be a string" };
    query = input.query.trim() || undefined;
  }

  const viewCenter = store.getView().center;
  let origin = viewCenter;
  let radius_m = rad.radius_m;
  if (input.near !== undefined) {
    const near = resolveNear(input.near, store.getFeatures(), viewCenter);
    if (near.kind === "invalid") return { error: near.error };
    if (near.kind === "none") return { error: "unknown place" };
    if (near.kind === "ambiguous") return { error: "ambiguous place", candidates: near.candidates };
    origin = near.center;
    radius_m = radius_m ?? DEFAULT_RADIUS_M;
  }

  return { origin, radius_m, categories: cats.categories, query, limit: lim.limit };
}

interface FeatureListOutput {
  total: number;
  returned: number;
  features: FeatureOutput[];
}

function listOutput(matched: GlassMapFeature[], origin: LngLat, limit: number): FeatureListOutput {
  const page = matched.slice(0, limit);
  return {
    total: matched.length,
    returned: page.length,
    features: page.map((f) => describeFeature(f, origin)),
  };
}

// ---------------------------------------------------------------------- tools

export function createMapTools(store: MapToolStore): GlassMapTool[] {
  const getMapState: GlassMapTool = {
    name: "get_map_state",
    description:
      "Read the current map view: camera (center, zoom, bearing, pitch), the visible bounds, how many features are loaded, and the selection. selection.count is the exact number of selected features; selection.ids lists at most the first 20 of them. Use this instead of a screenshot to know what the map shows.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: () => describeState(store),
  };

  const setMapView: GlassMapTool<SetMapViewInput> = {
    name: "set_map_view",
    description:
      "Move the map camera. Give a place name or a feature id to jump to something by name, or center/zoom/bearing/pitch to position the camera directly. Returns the new map state, so no follow-up read is needed.",
    inputSchema: {
      type: "object",
      properties: {
        center: {
          type: "object",
          properties: {
            lng: { type: "number", minimum: -180, maximum: 180, description: "Longitude in degrees." },
            lat: { type: "number", minimum: -90, maximum: 90, description: "Latitude in degrees." },
          },
          required: ["lng", "lat"],
          additionalProperties: false,
          description: "Exact camera centre. Cannot be combined with place or feature_id.",
        },
        zoom: {
          type: "number",
          minimum: 0,
          maximum: 22,
          description: `Zoom level: 10 shows a city, 15 a neighbourhood, 18 a building. Defaults to ${PLACE_ZOOM} when place or feature_id is used.`,
        },
        bearing: {
          type: "number",
          description: "Map rotation in degrees clockwise from north; 0 is north-up.",
        },
        pitch: {
          type: "number",
          minimum: 0,
          maximum: 85,
          description: "Camera tilt in degrees; 0 looks straight down.",
        },
        place: {
          type: "string",
          description:
            'Name of a place in the loaded data, e.g. "Daan Station". Station suffixes are optional. If several places match equally well the map does not move and the answer lists candidates to choose from.',
        },
        feature_id: {
          type: "string",
          description:
            'Id of a loaded feature, e.g. "osm:node:123". Use this instead of place when you already have an id, or to resolve an ambiguous place.',
        },
      },
      additionalProperties: false,
    },
    // Candidates for an ambiguous place echo OSM names, which are third-party text.
    annotations: { untrustedContentHint: true },
    execute: (input) => {
      const inp = input ?? {};
      const state = () => describeState(store);
      const hasPlace = inp.place !== undefined;
      const hasFeatureId = inp.feature_id !== undefined;
      const hasCamera = [inp.center, inp.zoom, inp.bearing, inp.pitch].some((v) => v !== undefined);

      if (hasPlace && hasFeatureId) {
        return { error: "provide either place or feature_id, not both", state: state() };
      }
      if ((hasPlace || hasFeatureId) && inp.center !== undefined) {
        return { error: "provide either center or place/feature_id, not both", state: state() };
      }
      if (!hasCamera && !hasPlace && !hasFeatureId) {
        return {
          error: "provide at least one of center, zoom, bearing, pitch, place, feature_id",
          state: state(),
        };
      }

      let patch: Partial<MapView> = {};
      if (hasCamera) {
        const v = validateSetMapView({
          center: inp.center,
          zoom: inp.zoom,
          bearing: inp.bearing,
          pitch: inp.pitch,
        });
        if ("error" in v) return { error: v.error, state: state() };
        patch = v.patch;
      }

      if (hasFeatureId) {
        if (typeof inp.feature_id !== "string" || !inp.feature_id.trim()) {
          return { error: "feature_id must be a non-empty string", state: state() };
        }
        const id = inp.feature_id.trim();
        const feature = store.getFeatures().find((f) => f.properties?.id === id);
        if (!feature) return { error: "unknown feature_id", state: state() };
        const center = featureCenter(feature);
        if (!center) return { error: "feature has no usable geometry", state: state() };
        patch.center = center;
        patch.zoom = patch.zoom ?? PLACE_ZOOM;
      }

      if (hasPlace) {
        if (typeof inp.place !== "string" || !inp.place.trim()) {
          return { error: "place must be a non-empty string", state: state() };
        }
        const resolved = resolvePlaceOne(inp.place, store.getFeatures(), store.getView().center);
        if (resolved.kind === "none") return { error: "unknown place", state: state() };
        if (resolved.kind === "ambiguous") {
          // Never guess: an agent cannot see that the map went to the wrong place.
          return { error: "ambiguous place", candidates: resolved.candidates, state: state() };
        }
        patch.center = resolved.entry.center;
        patch.zoom = patch.zoom ?? PLACE_ZOOM;
      }

      store.setView(patch);
      return describeState(store);
    },
  };

  const listFeaturesInView: GlassMapTool<ListFeaturesInViewInput> = {
    name: "list_features_in_view",
    description:
      "List the loaded features whose bounding box overlaps the current view, nearest to the centre of the view first, each with its distance in metres and an 8-point compass direction from that centre. The test is a bounding-box overlap, so a large area counts as in view when any part of it is. This is how you describe what is on screen without taking a screenshot.",
    inputSchema: {
      type: "object",
      properties: { categories: categoriesProperty, limit: limitProperty },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) => {
      const inp = input ?? {};
      const cats = validateCategories(inp.categories);
      if ("error" in cats) return { error: cats.error };
      const lim = validateLimit(inp.limit);
      if ("error" in lim) return { error: lim.error };

      const bounds = store.getBounds();
      if (!bounds) return { error: "map not ready" };

      const origin = store.getView().center;
      const visible = store.getFeatures().filter((f) => {
        const b = featureBounds(f);
        return b ? boundsIntersect(b, bounds) : false;
      });
      return listOutput(queryFeatures(visible, { origin, categories: cats.categories }), origin, lim.limit);
    },
  };

  const findFeatures: GlassMapTool<FindFeaturesInput> = {
    name: "find_features",
    description:
      "Search every loaded feature, not only the visible ones. Filter by name, category and distance from a place, a feature or a coordinate. Results come back nearest first, each with its distance in metres and an 8-point compass direction from that origin.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Case-insensitive substring of the local or English name. Omit to match every name.",
        },
        categories: categoriesProperty,
        near: nearProperty,
        radius_m: radiusProperty,
        limit: limitProperty,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) => {
      const inp = input ?? {};
      if (inp.within !== undefined) return { error: "within is not available yet" };
      const resolved = resolveQueryInput(store, inp);
      if ("error" in resolved) return resolved;
      return listOutput(queryFeatures(store.getFeatures(), resolved), resolved.origin, resolved.limit);
    },
  };

  const selectFeatures: GlassMapTool<SelectFeaturesInput> = {
    name: "select_features",
    description:
      "Highlight features on the map and in the sidebar so a sighted person can see what you are talking about. Pass explicit ids, or the same query/near/radius_m/categories filter as find_features — the filter selects exactly the features find_features would return for it. Pass an empty ids array to clear the selection. Returns the resulting selection and the new map state; selected lists at most 20 features while state.selection.count is the true total.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_IDS,
          description: `Feature ids to select, as returned by find_features or list_features_in_view (at most ${MAX_IDS}; use the filter instead for larger sets). An empty array clears the selection. Ids that are not loaded are reported in unknown_ids instead of failing the call.`,
        },
        query: {
          type: "string",
          description:
            "Case-insensitive substring of the local or English name, exactly as in find_features.",
        },
        near: nearProperty,
        radius_m: radiusProperty,
        categories: categoriesProperty,
        replace: {
          type: "boolean",
          description: "true (the default) replaces the current selection; false adds to it.",
        },
      },
      additionalProperties: false,
    },
    // Returns OSM names.
    annotations: { untrustedContentHint: true },
    execute: (input) => {
      const inp = input ?? {};
      const state = () => describeState(store);
      if (inp.within !== undefined) {
        // Silently ignoring it would select every feature the rest of the
        // filter matches — the opposite of what "within this shape" asked for.
        return {
          error: "within is not available yet; call find_features first and pass ids",
          state: state(),
        };
      }
      if (inp.replace !== undefined && typeof inp.replace !== "boolean") {
        return { error: "replace must be a boolean", state: state() };
      }
      const replace = inp.replace === undefined ? true : inp.replace;

      const hasIds = inp.ids !== undefined;
      const hasFilter =
        inp.query !== undefined ||
        inp.near !== undefined ||
        inp.categories !== undefined ||
        inp.radius_m !== undefined;
      if (!hasIds && !hasFilter) {
        return {
          error: "provide ids, or query/near/categories/radius_m to select by filter",
          state: state(),
        };
      }

      const all = store.getFeatures();
      const byId = new Map<string, GlassMapFeature>();
      for (const f of all) if (f?.properties?.id) byId.set(f.properties.id, f);

      const unknown_ids: string[] = [];
      const targets: GlassMapFeature[] = [];
      if (hasIds) {
        if (!Array.isArray(inp.ids) || inp.ids.some((id) => typeof id !== "string")) {
          return { error: "ids must be an array of feature id strings", state: state() };
        }
        if (inp.ids.length > MAX_IDS) {
          return { error: `ids must have at most ${MAX_IDS} entries`, state: state() };
        }
        for (const raw of inp.ids as string[]) {
          const feature = byId.get(raw.trim());
          if (feature) targets.push(feature);
          else unknown_ids.push(raw);
        }
      }

      let origin: LngLat | null = null;
      if (hasFilter) {
        const resolved = resolveQueryInput(store, inp);
        if ("error" in resolved) return { ...resolved, state: state() };
        origin = resolved.origin;
        targets.push(...queryFeatures(all, resolved));
      }

      // Keeping only ids we can still resolve drops leftovers from a previous
      // dataset instead of carrying dead ids into the UI.
      const nextIds = replace ? [] : store.getSelection().filter((id) => byId.has(id));
      for (const f of targets) if (!nextIds.includes(f.properties.id)) nextIds.push(f.properties.id);
      store.setSelection(nextIds);

      return {
        selected: nextIds
          .slice(0, SELECTION_ID_LIMIT)
          .map((id) => describeFeature(byId.get(id)!, origin)),
        // Echoing hundreds of bad ids helps nobody; the count still does.
        unknown_ids: unknown_ids.slice(0, SELECTION_ID_LIMIT),
        unknown_count: unknown_ids.length,
        state: describeState(store),
      };
    },
  };

  return [
    getMapState,
    setMapView as GlassMapTool,
    listFeaturesInView as GlassMapTool,
    findFeatures as GlassMapTool,
    selectFeatures as GlassMapTool,
  ];
}
