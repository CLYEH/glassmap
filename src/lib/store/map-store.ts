import { create } from "zustand";
import type { Geometry } from "geojson";
import type { GlassMapFeature } from "@/lib/data/schema";
import {
  appendTier2Features,
  createTier2Registry,
  httpFetchJson,
  notFoundFetchJson,
  sortedCategories,
  type FetchJson,
  type MapFeature,
  type Tier2Category,
  type Tier2LoadResult,
  type Tier2Manifest,
  type Tier2ManifestResult,
  type Tier2RestoreFailure,
  type Tier2RestoreResult,
} from "./tier2";

/** [lng, lat] */
export type LngLat = [number, number];

/** [west, south, east, north] */
export type Bounds = [number, number, number, number];

export interface MapView {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

/** Taipei Main Station area. */
export const DEFAULT_VIEW: MapView = {
  center: [121.5175, 25.0478],
  zoom: 12,
  bearing: 0,
  pitch: 0,
};

/**
 * The narrow interface tools use to read/write map state.
 * Tools never import React or MapLibre; tests pass an in-memory adapter.
 *
 * Ownership of each field:
 *  - view: written by tools (set_map_view) and by the map (user pans/zooms)
 *  - bounds: written by the map only, after every move; null until the map has rendered
 *  - features: the six bundled datasets, written by the data loader once, plus
 *    every tier-2 category a tool has loaded since (see `loadCategory`)
 *  - selection: written by tools (select_features) and by the UI (click)
 *  - activity: written by the tool layer only; read by the page
 */
export interface MapToolStore {
  getView(): MapView;
  setView(patch: Partial<MapView>): void;
  getBounds(): Bounds | null;
  /** Bundled datasets plus every loaded tier-2 category, in load order. */
  getFeatures(): readonly MapFeature[];
  /**
   * The tier-2 index as currently known, or null when nothing has read it yet.
   * Synchronous on purpose: `describeState` must never make a network request.
   */
  getTier2Manifest(): Tier2Manifest | null;
  /** Fetches `/data/tier2/index.json` once per page. Never throws. */
  loadTier2Manifest(): Promise<Tier2ManifestResult>;
  /** Sorted and deduped, so it never reveals the order categories were asked for. */
  getLoadedCategories(): readonly Tier2Category[];
  /**
   * Fetches one whole-city category into `getFeatures()`. Idempotent, safe to
   * call concurrently for the same category, and never throws: a failure comes
   * back as `{ ok: false, error }` for the tool to hand to the agent verbatim.
   * Loaded features stay until the page unloads — there is no eviction, by
   * design (see `tier2.ts`).
   */
  loadCategory(category: Tier2Category): Promise<Tier2LoadResult>;
  /**
   * Categories an incoming share link declared whose files have not settled
   * yet — neither loaded nor failed. Non-empty means the map is still becoming
   * the one that was shared, which is why `select_features` must not treat an
   * id it cannot resolve as a leftover to prune.
   */
  getPendingCategories(): readonly Tier2Category[];
  /**
   * Categories from the incoming link that failed, with the loader's reason and
   * whether asking again could ever help. An entry disappears the moment its
   * category loads by any route, so this never contradicts `getFeatures()`.
   */
  getRestoreFailures(): readonly Tier2RestoreFailure[];
  /**
   * Load the categories a share link declared. Marks them pending
   * synchronously and resolves once every one of them has loaded or failed;
   * never throws.
   */
  restoreCategories(categories: readonly Tier2Category[]): Promise<Tier2RestoreResult>;
  getSelection(): readonly string[];
  setSelection(ids: string[]): void;
  getDrawings(): readonly Drawing[];
  /** Returns the stored drawing with its assigned `drawing:<n>` id. */
  addDrawing(drawing: Omit<Drawing, "id">): Drawing;
  /** False when the id does not exist. */
  removeDrawing(id: string): boolean;
  getAnnotations(): readonly Annotation[];
  /** Returns the stored annotation with its assigned `annotation:<n>` id. */
  addAnnotation(annotation: Omit<Annotation, "id">): Annotation;
  /** False when the id does not exist. */
  removeAnnotation(id: string): boolean;
  /**
   * Append one call to the agent-activity feed. Write-only from here: tools
   * report what they did, only the page reads it back.
   */
  recordActivity(entry: Omit<ActivityEntry, "seq" | "at">): void;
}

/**
 * A shape on the map, drawn by a tool (`source: "agent"`) or by hand
 * (`source: "user"`). Ids (`drawing:<n>`) are assigned by the store so both
 * sources share one sequence. Circles keep their centre/radius; `geometry`
 * always holds the renderable/queryable form (Polygon for circle and polygon,
 * LineString for line).
 */
export interface Drawing {
  id: string;
  source: "agent" | "user";
  kind: "circle" | "polygon" | "line";
  label?: string;
  geometry: Geometry;
  /** Circles only. */
  center?: LngLat;
  /** Circles only. */
  radius_m?: number;
}

/** A note pinned to a location. Ids are `annotation:<n>`, store-assigned. */
export interface Annotation {
  id: string;
  source: "agent" | "user";
  at: LngLat;
  note: string;
  icon?: string;
}

/**
 * One WebMCP tool call, as the page shows it in the agent-activity feed.
 * The tool layer records every call it serves, so the human watching the
 * screen sees what the agent is doing without reading JSON.
 */
export interface ActivityEntry {
  /** Store-assigned, increasing from 1; keeps counting past the cap. */
  seq: number;
  /** Tool name, e.g. "draw_shape". */
  tool: string;
  /** One humanised line, e.g. `Circle, 800 m — “10-min walk” → drawing:1`. */
  summary: string;
  /** The tool's readOnlyHint: reads and writes are shown differently. */
  readOnly: boolean;
  /** False when the call answered with an error instead of a result. */
  ok: boolean;
  /** Epoch ms. */
  at: number;
  /** Ids the call produced or acted on — exactly those named in `summary`. */
  refIds?: string[];
}

/**
 * How many entries the feed keeps. It is a live view of what just happened,
 * not a log: an unbounded list would grow for as long as the tab is open and
 * nothing reads past the visible rows.
 */
export const ACTIVITY_LIMIT = 50;

/** Newest last, capped; `seq` is unaffected by dropping the oldest. */
function appendActivity(
  list: readonly ActivityEntry[],
  entry: Omit<ActivityEntry, "seq" | "at">,
  seq: number,
): ActivityEntry[] {
  return [...list, { ...entry, seq, at: Date.now() }].slice(-ACTIVITY_LIMIT);
}

/** Which WebMCP surfaces picked up our tools; null until registration ran. */
export interface WebMcpInfo {
  surfaces: string[];
  toolCount: number;
}

/**
 * The tool-facing feature list: the bundled datasets first, then whatever
 * tier-2 categories have been loaded. Rebuilt only when one of the two slices
 * changes, and — when no category is loaded — literally the bundled array, so a
 * page that never touches tier-2 behaves exactly as it did before it existed.
 */
function makeFeatureView() {
  let lastBundled: readonly GlassMapFeature[] | null = null;
  let lastTier2: readonly MapFeature[] | null = null;
  let combined: readonly MapFeature[] = [];
  return (bundled: readonly GlassMapFeature[], tier2: readonly MapFeature[]) => {
    if (bundled !== lastBundled || tier2 !== lastTier2) {
      lastBundled = bundled;
      lastTier2 = tier2;
      combined = tier2.length === 0 ? bundled : [...bundled, ...tier2];
    }
    return combined;
  };
}

interface MapStore {
  view: MapView;
  setView: (patch: Partial<MapView>) => void;
  bounds: Bounds | null;
  setBounds: (bounds: Bounds | null) => void;
  /** The six bundled datasets. What the map renders today; the UI owns this. */
  features: GlassMapFeature[];
  setFeatures: (features: GlassMapFeature[]) => void;
  /**
   * Point-of-interest features from the categories a tool has loaded. Kept
   * apart from `features` so the rendering the UI already does is untouched
   * until it opts in.
   */
  tier2Features: MapFeature[];
  /** Sorted; a category appears here only once its features are in the store. */
  tier2Loaded: Tier2Category[];
  /**
   * Categories a share link declared that are still being fetched. The page can
   * show "still loading"; the tool layer uses it to keep the link's selection
   * alive until the answer is known.
   */
  tier2Pending: Tier2Category[];
  /**
   * Non-empty means a shared link's map cannot be reproduced here, and why.
   * A category that loads later leaves this list in the same write.
   */
  tier2RestoreFailures: Tier2RestoreFailure[];
  /** See `MapToolStore.restoreCategories`; this is the same call, for the page. */
  restoreTier2Categories: (categories: readonly Tier2Category[]) => Promise<Tier2RestoreResult>;
  tier2Manifest: Tier2Manifest | null;
  selection: string[];
  setSelection: (ids: string[]) => void;
  drawings: Drawing[];
  drawingSeq: number;
  addDrawing: (drawing: Omit<Drawing, "id">) => Drawing;
  removeDrawing: (id: string) => boolean;
  annotations: Annotation[];
  annotationSeq: number;
  addAnnotation: (annotation: Omit<Annotation, "id">) => Annotation;
  removeAnnotation: (id: string) => boolean;
  activity: ActivityEntry[];
  activitySeq: number;
  recordActivity: (entry: Omit<ActivityEntry, "seq" | "at">) => void;
  webmcp: WebMcpInfo | null;
  setWebMcp: (info: WebMcpInfo | null) => void;
}

export const useMapStore = create<MapStore>((set, get) => ({
  view: DEFAULT_VIEW,
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  bounds: null,
  setBounds: (bounds) => set({ bounds }),
  features: [],
  setFeatures: (features) => set({ features }),
  tier2Features: [],
  tier2Loaded: [],
  tier2Pending: [],
  tier2RestoreFailures: [],
  // The loader is created below (it needs this store); read at call time.
  restoreTier2Categories: (categories) => zustandTier2.restoreCategories(categories),
  tier2Manifest: null,
  selection: [],
  setSelection: (selection) => set({ selection }),
  drawings: [],
  drawingSeq: 1,
  addDrawing: (drawing) => {
    const stored: Drawing = { ...drawing, id: `drawing:${get().drawingSeq}` };
    set((s) => ({ drawings: [...s.drawings, stored], drawingSeq: s.drawingSeq + 1 }));
    return stored;
  },
  removeDrawing: (id) => {
    const exists = get().drawings.some((d) => d.id === id);
    if (exists) set((s) => ({ drawings: s.drawings.filter((d) => d.id !== id) }));
    return exists;
  },
  annotations: [],
  annotationSeq: 1,
  addAnnotation: (annotation) => {
    const stored: Annotation = { ...annotation, id: `annotation:${get().annotationSeq}` };
    set((s) => ({ annotations: [...s.annotations, stored], annotationSeq: s.annotationSeq + 1 }));
    return stored;
  },
  removeAnnotation: (id) => {
    const exists = get().annotations.some((a) => a.id === id);
    if (exists) set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) }));
    return exists;
  },
  activity: [],
  activitySeq: 1,
  recordActivity: (entry) =>
    set((s) => ({
      activity: appendActivity(s.activity, entry, s.activitySeq),
      activitySeq: s.activitySeq + 1,
    })),
  webmcp: null,
  setWebMcp: (webmcp) => set({ webmcp }),
}));

const zustandFeatureView = makeFeatureView();

/**
 * The one tier-2 loader the app uses. Module-level because its in-flight map is
 * what keeps two concurrent tool calls from fetching the same file twice, and
 * there is exactly one Zustand store per page.
 */
const zustandTier2 = createTier2Registry({
  fetchJson: (url) => httpFetchJson(url),
  getManifest: () => useMapStore.getState().tier2Manifest,
  setManifest: (tier2Manifest) => useMapStore.setState({ tier2Manifest }),
  getLoadedCategories: () => useMapStore.getState().tier2Loaded,
  addLoadedCategory: (category, features) =>
    useMapStore.setState((s) => ({
      tier2Features: appendTier2Features(s.features, s.tier2Features, features),
      tier2Loaded: sortedCategories([...s.tier2Loaded, category]),
      // Same write as the features, so nothing that reads this store can catch
      // it saying "cafe is loaded" and "cafe could not load" at once — which is
      // what the restore notice was still showing over a map full of cafes.
      tier2RestoreFailures: s.tier2RestoreFailures.filter((f) => f.category !== category),
    })),
  getPendingCategories: () => useMapStore.getState().tier2Pending,
  setPendingCategories: (tier2Pending) => useMapStore.setState({ tier2Pending }),
  getRestoreFailures: () => useMapStore.getState().tier2RestoreFailures,
  setRestoreFailures: (tier2RestoreFailures) => useMapStore.setState({ tier2RestoreFailures }),
});

/** Adapter over the Zustand store for the tool layer. */
export const zustandToolStore: MapToolStore = {
  getView: () => useMapStore.getState().view,
  setView: (patch) => useMapStore.getState().setView(patch),
  getBounds: () => useMapStore.getState().bounds,
  getFeatures: () => {
    const { features, tier2Features } = useMapStore.getState();
    return zustandFeatureView(features, tier2Features);
  },
  getTier2Manifest: () => useMapStore.getState().tier2Manifest,
  loadTier2Manifest: () => zustandTier2.loadManifest(),
  getLoadedCategories: () => useMapStore.getState().tier2Loaded,
  loadCategory: (category) => zustandTier2.loadCategory(category),
  getPendingCategories: () => useMapStore.getState().tier2Pending,
  getRestoreFailures: () => useMapStore.getState().tier2RestoreFailures,
  restoreCategories: (categories) => zustandTier2.restoreCategories(categories),
  getSelection: () => useMapStore.getState().selection,
  setSelection: (ids) => useMapStore.getState().setSelection(ids),
  getDrawings: () => useMapStore.getState().drawings,
  addDrawing: (drawing) => useMapStore.getState().addDrawing(drawing),
  removeDrawing: (id) => useMapStore.getState().removeDrawing(id),
  getAnnotations: () => useMapStore.getState().annotations,
  addAnnotation: (annotation) => useMapStore.getState().addAnnotation(annotation),
  removeAnnotation: (id) => useMapStore.getState().removeAnnotation(id),
  recordActivity: (entry) => useMapStore.getState().recordActivity(entry),
};

export interface MemoryToolStoreInit {
  view?: MapView;
  bounds?: Bounds | null;
  features?: GlassMapFeature[];
  selection?: string[];
  drawings?: Drawing[];
  annotations?: Annotation[];
  /**
   * Serves `/data/tier2/index.json` and the category files. Defaults to a 404
   * for everything, which is a page with no tier-2 data at all — the state the
   * whole suite runs in unless a test opts in.
   */
  tier2FetchJson?: FetchJson;
}

/**
 * The in-memory adapter plus the one reader tests need. Activity is
 * write-only on `MapToolStore` because no tool ever reads it back.
 */
export interface MemoryToolStore extends MapToolStore {
  /** Oldest first, capped exactly like the Zustand slice. */
  getActivity(): readonly ActivityEntry[];
}

/** In-memory adapter for unit tests. */
export function createMemoryToolStore(init: MemoryToolStoreInit = {}): MemoryToolStore {
  let view = { ...(init.view ?? DEFAULT_VIEW) };
  const bounds = init.bounds ?? null;
  const features = init.features ?? [];
  let tier2Features: MapFeature[] = [];
  let tier2Loaded: Tier2Category[] = [];
  let tier2Pending: Tier2Category[] = [];
  let tier2RestoreFailures: Tier2RestoreFailure[] = [];
  let tier2Manifest: Tier2Manifest | null = null;
  const featureView = makeFeatureView();
  const tier2 = createTier2Registry({
    fetchJson: init.tier2FetchJson ?? notFoundFetchJson,
    getManifest: () => tier2Manifest,
    setManifest: (manifest) => {
      tier2Manifest = manifest;
    },
    getLoadedCategories: () => tier2Loaded,
    addLoadedCategory: (category, loaded) => {
      tier2Features = appendTier2Features(features, tier2Features, loaded);
      tier2Loaded = sortedCategories([...tier2Loaded, category]);
      tier2RestoreFailures = tier2RestoreFailures.filter((f) => f.category !== category);
    },
    getPendingCategories: () => tier2Pending,
    setPendingCategories: (categories) => {
      tier2Pending = categories;
    },
    getRestoreFailures: () => tier2RestoreFailures,
    setRestoreFailures: (failures) => {
      tier2RestoreFailures = failures;
    },
  });
  let selection = [...(init.selection ?? [])];
  let drawings = [...(init.drawings ?? [])];
  let drawingSeq = drawings.length + 1;
  let annotations = [...(init.annotations ?? [])];
  let annotationSeq = annotations.length + 1;
  let activity: ActivityEntry[] = [];
  let activitySeq = 1;
  return {
    getView: () => view,
    setView: (patch) => {
      view = { ...view, ...patch };
    },
    getBounds: () => bounds,
    getFeatures: () => featureView(features, tier2Features),
    getTier2Manifest: () => tier2Manifest,
    loadTier2Manifest: () => tier2.loadManifest(),
    getLoadedCategories: () => tier2Loaded,
    loadCategory: (category) => tier2.loadCategory(category),
    getPendingCategories: () => tier2Pending,
    getRestoreFailures: () => tier2RestoreFailures,
    restoreCategories: (categories) => tier2.restoreCategories(categories),
    getSelection: () => selection,
    setSelection: (ids) => {
      selection = [...ids];
    },
    getDrawings: () => drawings,
    addDrawing: (drawing) => {
      const stored: Drawing = { ...drawing, id: `drawing:${drawingSeq++}` };
      drawings = [...drawings, stored];
      return stored;
    },
    removeDrawing: (id) => {
      const exists = drawings.some((d) => d.id === id);
      drawings = drawings.filter((d) => d.id !== id);
      return exists;
    },
    getAnnotations: () => annotations,
    addAnnotation: (annotation) => {
      const stored: Annotation = { ...annotation, id: `annotation:${annotationSeq++}` };
      annotations = [...annotations, stored];
      return stored;
    },
    removeAnnotation: (id) => {
      const exists = annotations.some((a) => a.id === id);
      annotations = annotations.filter((a) => a.id !== id);
      return exists;
    },
    recordActivity: (entry) => {
      activity = appendActivity(activity, entry, activitySeq++);
    },
    getActivity: () => activity,
  };
}
