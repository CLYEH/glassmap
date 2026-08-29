import { create } from "zustand";
import type { Geometry } from "geojson";
import type { GlassMapFeature } from "@/lib/data/schema";

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
 *  - features: written by the data loader once; read by tools and the map
 *  - selection: written by tools (select_features) and by the UI (click)
 *  - activity: written by the tool layer only; read by the page
 */
export interface MapToolStore {
  getView(): MapView;
  setView(patch: Partial<MapView>): void;
  getBounds(): Bounds | null;
  getFeatures(): readonly GlassMapFeature[];
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

interface MapStore {
  view: MapView;
  setView: (patch: Partial<MapView>) => void;
  bounds: Bounds | null;
  setBounds: (bounds: Bounds | null) => void;
  features: GlassMapFeature[];
  setFeatures: (features: GlassMapFeature[]) => void;
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

/** Adapter over the Zustand store for the tool layer. */
export const zustandToolStore: MapToolStore = {
  getView: () => useMapStore.getState().view,
  setView: (patch) => useMapStore.getState().setView(patch),
  getBounds: () => useMapStore.getState().bounds,
  getFeatures: () => useMapStore.getState().features,
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
    getFeatures: () => features,
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
