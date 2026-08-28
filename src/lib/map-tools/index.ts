import type { Geometry, MultiPolygon, Polygon } from "geojson";
import type { GlassMapTool } from "@/lib/webmcp/types";
import type { LngLat, MapToolStore, MapView } from "@/lib/store/map-store";
import { FEATURE_CATEGORIES, type FeatureCategory, type GlassMapFeature } from "@/lib/data/schema";
import { describeState, round5, SELECTION_ID_LIMIT } from "./state";
import {
  boundsIntersect,
  describeFeature,
  featureBounds,
  featureCenter,
  type FeatureOutput,
} from "./output";
import { resolvePlaceOne } from "./gazetteer";
import {
  circleGeometry,
  DEFAULT_CIRCLE_RADIUS_M,
  isAreaGeometry,
  isShapeKind,
  MAX_ICON_CHARS,
  MAX_LABEL_CHARS,
  MAX_NOTE_CHARS,
  MAX_RADIUS_M,
  MAX_SHAPE_POINTS,
  measureGeometry,
  SHAPE_KINDS,
  toRing,
  validateOptionalText,
  validatePositions,
  validateRadiusM,
  validateRequiredText,
  type ShapeKind,
} from "./shapes";
import {
  DEFAULT_SURROUNDINGS_RADIUS_M,
  findDistrict,
  groupByDirection,
  NEIGHBOUR_CATEGORIES,
  SURROUNDINGS_ITEM_LIMIT,
} from "./surroundings";
import {
  COMPARE_CATEGORIES,
  compareSummary,
  summariseArea,
} from "./compare";
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

export interface DrawShapeInput {
  type?: unknown;
  center?: unknown;
  radius_m?: unknown;
  coordinates?: unknown;
  label?: unknown;
}

export interface AnnotateInput {
  at?: unknown;
  note?: unknown;
  icon?: unknown;
}

export interface DescribeSurroundingsInput {
  from?: unknown;
  radius_m?: unknown;
}

export interface CompareAreasInput {
  a?: unknown;
  b?: unknown;
  radius_m?: unknown;
  categories?: unknown;
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

/**
 * The three ways an agent can say "here": an id it already has, a name a human
 * said, or a coordinate. Every tool that takes a location takes all three.
 */
const pointProperty = (description: string) => ({
  description,
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
});

const nearProperty = pointProperty(
  'Origin for distances and for the radius filter: a feature id returned by an earlier call (e.g. "osm:node:123"), a place name to look up in the loaded data (e.g. "Daan Station"), or an explicit coordinate. Omit to measure from the centre of the current view.',
);

const withinProperty = {
  type: "string",
  description:
    '"drawing:<n>" - restrict results to features inside that drawing, as returned by draw_shape or listed in map state under drawings (the ten most recent; drawings.count is the true total). A circle or polygon works; a line has no inside. Combines with the other filters instead of replacing them.',
};

const radiusProperty = {
  type: "number",
  exclusiveMinimum: 0,
  maximum: MAX_RADIUS_M,
  description: `Keep only features within this many metres of "near" (default ${DEFAULT_RADIUS_M} when "near" is given, no radius filter otherwise, at most ${MAX_RADIUS_M}). A larger radius is refused rather than quietly narrowed. Measured to a feature point, or to the centroid of an area.`,
};

// ------------------------------------------------------------------ internals

interface ResolvedQuery {
  origin: LngLat;
  radius_m?: number;
  categories?: FeatureCategory[];
  query?: string;
  within?: Polygon | MultiPolygon;
  limit: number;
}

type QueryError = {
  error: string;
  candidates?: unknown;
  known_ids?: string[];
  known_count?: number;
};

/**
 * One location out of the three forms every location parameter accepts.
 * Rounded to 5 decimals (~1 m) so what the store keeps is what the agent is
 * told, and two calls that name the same place cannot differ in float dust.
 * `name` is what the id or the place name resolved to, absent for a coordinate.
 */
function resolvePoint(
  store: MapToolStore,
  value: unknown,
  field: string,
): { point: LngLat; name?: string } | QueryError {
  const near = resolveNear(value, store.getFeatures(), store.getView().center, field);
  if (near.kind === "invalid") return { error: near.error };
  if (near.kind === "none") return { error: "unknown place" };
  if (near.kind === "ambiguous") return { error: "ambiguous place", candidates: near.candidates };
  return {
    point: [round5(near.center[0]), round5(near.center[1])],
    ...(near.name ? { name: near.name } : {}),
  };
}

/**
 * A drawing id turned into the area to test against. Guessing here would be
 * the worst failure in the tool layer: "the shops inside the circle I drew"
 * must never quietly mean "every shop in Taipei", so an id we cannot resolve
 * comes back with the ids that do exist instead of an empty filter.
 */
function resolveWithin(
  store: MapToolStore,
  value: unknown,
): { area: Polygon | MultiPolygon } | QueryError {
  const drawings = store.getDrawings();
  // Most recent, like map state: past the cap, the oldest ids are the least
  // likely to be the one the caller meant.
  const known_ids = drawings.map((d) => d.id).slice(-SELECTION_ID_LIMIT);
  const known_count = drawings.length;
  if (typeof value !== "string" || !value.trim()) {
    return { error: 'within must be a drawing id like "drawing:1"', known_ids, known_count };
  }
  const drawing = drawings.find((d) => d.id === value.trim());
  if (!drawing) return { error: `unknown drawing id: ${value.trim()}`, known_ids, known_count };
  if (!isAreaGeometry(drawing.geometry)) {
    return {
      error: `within requires an area drawing (a circle or a polygon); ${drawing.id} is a ${drawing.kind}`,
    };
  }
  return { area: drawing.geometry };
}

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

  let within: Polygon | MultiPolygon | undefined;
  if (input.within !== undefined) {
    const area = resolveWithin(store, input.within);
    if ("error" in area) return area;
    within = area.area;
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

  return { origin, radius_m, categories: cats.categories, query, within, limit: lim.limit };
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
      "Read the current map view: camera (center, zoom, bearing, pitch), the visible bounds, how many features are loaded, the selection, and everything drawn or noted on the map by either side. Every count is exact; the lists are capped (selection.ids at 20, drawings.items and annotations.items at the ten most recent each, annotation notes at 80 characters). Use this instead of a screenshot to know what the map shows.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    // State echoes labels and notes a human may have typed on the page.
    annotations: { readOnlyHint: true, untrustedContentHint: true },
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
      "Search every loaded feature, not only the visible ones. Filter by name, category, distance from a place, a feature or a coordinate (up to 10000 m), and by whether a feature is inside a shape on the map - including one the human drew by hand. Results come back nearest first, each with its distance in metres and an 8-point compass direction from that origin.",
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
        within: withinProperty,
        limit: limitProperty,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) => {
      const inp = input ?? {};
      const resolved = resolveQueryInput(store, inp);
      if ("error" in resolved) return resolved;
      return listOutput(queryFeatures(store.getFeatures(), resolved), resolved.origin, resolved.limit);
    },
  };

  const selectFeatures: GlassMapTool<SelectFeaturesInput> = {
    name: "select_features",
    description:
      "Highlight features on the map and in the sidebar so a sighted person can see what you are talking about. Pass explicit ids (from find_features, list_features_in_view or describe_surroundings), or the same query/near/radius_m (at most 10000 m)/categories/within filter as find_features — the filter resolves to the same set of features, but unlike find_features it does not stop at `limit`: every match is selected, and state.selection.count reports the true number. Pass an empty ids array to clear the selection. Returns the resulting selection and the new map state; selected lists at most 20 of them.",
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
        within: withinProperty,
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
      if (inp.replace !== undefined && typeof inp.replace !== "boolean") {
        return { error: "replace must be a boolean", state: state() };
      }
      const replace = inp.replace === undefined ? true : inp.replace;

      const hasIds = inp.ids !== undefined;
      const hasFilter =
        inp.query !== undefined ||
        inp.near !== undefined ||
        inp.categories !== undefined ||
        inp.radius_m !== undefined ||
        inp.within !== undefined;
      if (!hasIds && !hasFilter) {
        return {
          error: "provide ids, or query/near/categories/radius_m/within to select by filter",
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

  const drawShape: GlassMapTool<DrawShapeInput> = {
    name: "draw_shape",
    description:
      "Draw a circle, a polygon or a line on the map, so the human can see the area you are talking about. A circle takes a centre (a coordinate, a feature id or a place name) and a radius in metres; a polygon and a line take a list of [lng, lat] points. Returns the drawing id plus its area in square metres (circle, polygon) or its length in metres (line), and the new map state. Pass the id to find_features({within}) or select_features({within}) to ask what is inside it. Shapes the human drew by hand appear in the same list with source \"user\" and can be queried the same way.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: [...SHAPE_KINDS],
          description:
            "circle: centre plus radius_m. polygon: a closed area from coordinates. line: a route or a measurement from coordinates.",
        },
        center: pointProperty(
          'Circle only: where the circle is centred. A coordinate, a feature id from an earlier call, or a place name such as "Daan Station". If a name matches several places the map is left alone and the answer lists the candidates.',
        ),
        radius_m: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: MAX_RADIUS_M,
          description: `Circle only: radius in metres (default ${DEFAULT_CIRCLE_RADIUS_M}, a comfortable walk; at most ${MAX_RADIUS_M}). A larger radius is refused rather than shrunk, so what you draw is always what you asked for.`,
        },
        coordinates: {
          type: "array",
          minItems: 2,
          maxItems: MAX_SHAPE_POINTS,
          items: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "number" },
            description: "One point as [lng, lat] in degrees.",
          },
          description: `Polygon or line only: the points, as [lng, lat] pairs. A polygon needs at least 3 distinct points and is closed for you if you do not repeat the first one; a line needs at least 2. At most ${MAX_SHAPE_POINTS} points.`,
        },
        label: {
          type: "string",
          maxLength: MAX_LABEL_CHARS,
          description: `Short name shown on the map and in map state, e.g. "10-minute walk" (at most ${MAX_LABEL_CHARS} characters).`,
        },
      },
      required: ["type"],
      additionalProperties: false,
    },
    // The state it returns carries labels and notes typed by the human.
    annotations: { untrustedContentHint: true },
    execute: (input) => {
      const inp = input ?? {};
      const state = () => describeState(store);

      if (!isShapeKind(inp.type)) {
        return { error: `type must be one of ${SHAPE_KINDS.join(", ")}`, state: state() };
      }
      const kind: ShapeKind = inp.type;
      const label = validateOptionalText(inp.label, "label", MAX_LABEL_CHARS);
      if ("error" in label) return { error: label.error, state: state() };

      let geometry: Geometry;
      let center: LngLat | undefined;
      let radius_m: number | undefined;

      if (kind === "circle") {
        if (inp.coordinates !== undefined) {
          return { error: "a circle takes center and radius_m, not coordinates", state: state() };
        }
        if (inp.center === undefined) {
          return {
            error: "circle requires center: a coordinate, a feature id or a place name",
            state: state(),
          };
        }
        const resolved = resolvePoint(store, inp.center, "center");
        if ("error" in resolved) return { ...resolved, state: state() };
        const radius = validateRadiusM(inp.radius_m, DEFAULT_CIRCLE_RADIUS_M);
        if ("error" in radius) return { error: radius.error, state: state() };
        center = resolved.point;
        radius_m = radius.radius_m;
        geometry = circleGeometry(center, radius_m);
      } else {
        if (inp.center !== undefined || inp.radius_m !== undefined) {
          return { error: `a ${kind} takes coordinates, not center/radius_m`, state: state() };
        }
        const points = validatePositions(inp.coordinates, kind === "polygon" ? 3 : 2);
        if ("error" in points) return { error: points.error, state: state() };
        if (kind === "polygon") {
          const ring = toRing(points.points);
          if ("error" in ring) return { error: ring.error, state: state() };
          geometry = { type: "Polygon", coordinates: [ring.ring] };
        } else {
          geometry = { type: "LineString", coordinates: points.points };
        }
      }

      // A shape with no extent is invisible to the human and still matches
      // `within`, so "what is in the area I drew" would answer about an area
      // nobody can see. Refuse it where it is made.
      const measure = measureGeometry(geometry);
      if (kind !== "line" && !measure.area_m2) {
        return {
          error:
            kind === "circle"
              ? "radius_m is too small: the circle encloses no area"
              : "the points are collinear or the ring is self-intersecting; it encloses no area",
          state: state(),
        };
      }

      const drawing = store.addDrawing({
        source: "agent",
        kind,
        ...(label.text ? { label: label.text } : {}),
        geometry,
        ...(center ? { center } : {}),
        ...(radius_m !== undefined ? { radius_m } : {}),
      });

      return { drawing_id: drawing.id, ...measure, state: describeState(store) };
    },
  };

  const annotate: GlassMapTool<AnnotateInput> = {
    name: "annotate",
    description:
      "Pin a short note to a place on the map, so the human sees what you found where you found it. The location can be a coordinate, a feature id from an earlier call, or a place name. Returns the annotation id and the new map state; map state lists notes with their first 80 characters and says whether the agent or the human wrote each one.",
    inputSchema: {
      type: "object",
      properties: {
        at: pointProperty(
          'Where to pin the note: a coordinate, a feature id such as "osm:node:123", or a place name such as "Daan Station". If a name matches several places nothing is pinned and the answer lists the candidates.',
        ),
        note: {
          type: "string",
          minLength: 1,
          maxLength: MAX_NOTE_CHARS,
          description: `The note itself, at most ${MAX_NOTE_CHARS} characters. One or two sentences a human can read on the map, not a paragraph.`,
        },
        icon: {
          type: "string",
          maxLength: MAX_ICON_CHARS,
          description: `Optional short marker label or emoji, e.g. "star" (at most ${MAX_ICON_CHARS} characters).`,
        },
      },
      required: ["at", "note"],
      additionalProperties: false,
    },
    // Echoes the note back, and notes are user-entered text.
    annotations: { untrustedContentHint: true },
    execute: (input) => {
      const inp = input ?? {};
      const state = () => describeState(store);

      const note = validateRequiredText(inp.note, "note", MAX_NOTE_CHARS);
      if ("error" in note) return { error: note.error, state: state() };
      const icon = validateOptionalText(inp.icon, "icon", MAX_ICON_CHARS);
      if ("error" in icon) return { error: icon.error, state: state() };
      if (inp.at === undefined) {
        return {
          error: "at is required: a coordinate, a feature id or a place name",
          state: state(),
        };
      }
      const at = resolvePoint(store, inp.at, "at");
      if ("error" in at) return { ...at, state: state() };

      const annotation = store.addAnnotation({
        source: "agent",
        at: at.point,
        note: note.text,
        ...(icon.text ? { icon: icon.text } : {}),
      });
      return { annotation_id: annotation.id, state: describeState(store) };
    },
  };

  const describeSurroundings: GlassMapTool<DescribeSurroundingsInput> = {
    name: "describe_surroundings",
    description:
      "Describe what is around a point the way a person would say it out loud: the district it is in, and the nearby features grouped by compass direction, nearest first, each with its feature id, name and distance in metres. Pass an id straight to select_features or set_map_view to act on something you just described. Use this to answer \"what is around me?\" or \"what is near this listing?\" without a screenshot. total is how many features are inside radius_m, returned is how many are described (at most 30, the nearest ones): when total is larger, narrow radius_m or use find_features with a category filter - widening the radius will not reveal the ones that were left out.",
    inputSchema: {
      type: "object",
      properties: {
        from: pointProperty(
          "Where to look from: a coordinate, a feature id from an earlier call, or a place name. Omit to describe the surroundings of the centre of the current view.",
        ),
        radius_m: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: MAX_RADIUS_M,
          description: `How far to look, in metres (default ${DEFAULT_SURROUNDINGS_RADIUS_M}, roughly a five-minute walk; at most ${MAX_RADIUS_M}).`,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) => {
      const inp = input ?? {};
      const radius = validateRadiusM(inp.radius_m, DEFAULT_SURROUNDINGS_RADIUS_M);
      if ("error" in radius) return { error: radius.error };

      let origin = store.getView().center;
      if (inp.from !== undefined) {
        const resolved = resolvePoint(store, inp.from, "from");
        if ("error" in resolved) return resolved;
        origin = resolved.point;
      }

      const features = store.getFeatures();
      const near = queryFeatures(features, {
        origin,
        radius_m: radius.radius_m,
        categories: NEIGHBOUR_CATEGORIES,
      });
      const groups = groupByDirection(near.slice(0, SURROUNDINGS_ITEM_LIMIT), origin);

      return {
        origin: { lng: round5(origin[0]), lat: round5(origin[1]) },
        district: findDistrict(features, origin),
        // Truncating in silence would teach the agent that a wider radius adds
        // nothing, and it would deny matches it was never shown.
        total: near.length,
        returned: groups.reduce((n, g) => n + g.items.length, 0),
        groups,
      };
    },
  };

  const compareAreas: GlassMapTool<CompareAreasInput> = {
    name: "compare_areas",
    description:
      'Compare two places in one call: how many features of each category are within radius_m of a, how many are within radius_m of b, and the nearest one of each category on each side. Both places are given the same way as anywhere else - a feature id, a place name such as "Zhongshan Station", or a coordinate - and both are counted with exactly the filter find_features uses, so the numbers match what a per-category search would return. Read "summary" out; use by_category to reason and its feature ids to act (select_features, set_map_view). This replaces one find_features call per category per place.',
    inputSchema: {
      type: "object",
      properties: {
        a: pointProperty(
          'The first place: a feature id from an earlier call, a place name such as "Daan Park Station", or an explicit coordinate. If a name matches several places nothing is counted and the answer lists the candidates.',
        ),
        b: pointProperty("The second place, in any of the same three forms as a."),
        radius_m: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: MAX_RADIUS_M,
          description: `How far around each place to count, in metres (default ${DEFAULT_RADIUS_M}, a comfortable walk; at most ${MAX_RADIUS_M}). The same radius is used on both sides - that is what makes the two counts comparable. A larger radius is refused rather than quietly narrowed.`,
        },
        categories: {
          ...categoriesProperty,
          description: `Which categories to count. Omit to count ${COMPARE_CATEGORIES.join(", ")} - every category except district, which is a property of a place rather than something near it. Values: ${FEATURE_CATEGORIES.join(", ")}.`,
        },
      },
      required: ["a", "b"],
      additionalProperties: false,
    },
    // Echoes OSM names: the resolved place names and the nearest feature of each category.
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) => {
      const inp = input ?? {};
      const cats = validateCategories(inp.categories);
      if ("error" in cats) return { error: cats.error };
      // Same order as asked for, without repeats: a duplicated category would
      // otherwise produce two identical summary lines and look like two results.
      const categories = [...new Set(cats.categories ?? COMPARE_CATEGORIES)];
      const radius = validateRadiusM(inp.radius_m, DEFAULT_RADIUS_M);
      if ("error" in radius) return { error: radius.error };

      if (inp.a === undefined || inp.b === undefined) {
        return { error: "compare_areas needs both a and b: two places to compare" };
      }
      // Which side failed matters: the agent has to know which of the two names
      // to ask the human about, and both errors otherwise read the same.
      const a = resolvePoint(store, inp.a, "a");
      if ("error" in a) return { ...a, field: "a" };
      const b = resolvePoint(store, inp.b, "b");
      if ("error" in b) return { ...b, field: "b" };

      const features = store.getFeatures();
      const left = summariseArea(features, a.point, radius.radius_m, categories, a.name);
      const right = summariseArea(features, b.point, radius.radius_m, categories, b.name);
      return {
        a: left,
        b: right,
        radius_m: radius.radius_m,
        summary: compareSummary(left, right, categories),
      };
    },
  };

  return [
    getMapState,
    setMapView as GlassMapTool,
    listFeaturesInView as GlassMapTool,
    findFeatures as GlassMapTool,
    selectFeatures as GlassMapTool,
    drawShape as GlassMapTool,
    annotate as GlassMapTool,
    describeSurroundings as GlassMapTool,
    compareAreas as GlassMapTool,
    ];
}
