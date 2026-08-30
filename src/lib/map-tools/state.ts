import type { Annotation, Bounds, Drawing, MapToolStore, MapView } from "@/lib/store/map-store";
import { measureGeometry, truncate } from "./shapes";

/** Round to 5 decimals (~1 m) to keep tool output small. */
export const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** How many selected ids describeState lists; the count is always exact. */
export const SELECTION_ID_LIMIT = 20;

/**
 * How many drawings/annotations describeState lists; the counts are exact and
 * the items are the *most recent* ones. Listing the oldest would hide the shape
 * the agent just drew as soon as the map holds more than ten.
 */
export const STATE_ITEM_LIMIT = 10;

/** Notes are the human's own words and can be long; state only shows the start. */
export const NOTE_PREVIEW_CHARS = 80;

/** Camera only — also rendered by the page, so it must stay stable. */
export interface ViewOutput {
  center: { lng: number; lat: number };
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface BoundsOutput {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** One drawing in map state: what it is and how big, never where. */
export interface DrawingOutput {
  id: string;
  kind: Drawing["kind"];
  label?: string;
  /** "user" means a human drew it by hand; "agent" means a tool did. */
  source: Drawing["source"];
  area_m2?: number;
  length_m?: number;
}

export interface AnnotationOutput {
  id: string;
  /** Truncated to NOTE_PREVIEW_CHARS; the store keeps the full text. */
  note: string;
  source: Annotation["source"];
}

/**
 * Which point-of-interest categories are in memory. Absent until something has
 * touched tier-2 at all: a page that never asks for a POI category reports the
 * same state it always did.
 */
export interface Tier2StateOutput {
  /** Sorted category names whose features are loaded, city-wide. */
  loaded: string[];
  /** How many categories the index offers in total. */
  available: number;
  /**
   * Categories a share link this page was opened with is still fetching. While
   * this is non-empty the map is not yet the one that was shared: selected ids
   * naming those features cannot be resolved yet, and nothing may treat them as
   * gone. Absent when nothing is loading.
   */
  loading?: string[];
  /**
   * Categories a share link declared that this page could not load, with the
   * reason. This is the loud half of the restore contract: it rides on every
   * tool answer, so an agent finds out that the map in front of it is not the
   * map it was sent without having to ask a second question.
   */
  failed?: { category: string; error: string }[];
}

/** Serialisable map state returned by get_map_state and every write tool. */
export interface MapStateOutput extends ViewOutput {
  /** Visible extent; null until the map has rendered once. */
  bounds: BoundsOutput | null;
  selection: { count: number; ids: string[] };
  /** Everything queryable: the bundled datasets plus every loaded category. */
  features_loaded: number;
  tier2?: Tier2StateOutput;
  drawings: { count: number; items: DrawingOutput[] };
  annotations: { count: number; items: AnnotationOutput[] };
}

export function describeView(view: MapView): ViewOutput {
  return {
    center: { lng: round5(view.center[0]), lat: round5(view.center[1]) },
    zoom: round5(view.zoom),
    bearing: round5(view.bearing),
    pitch: round5(view.pitch),
  };
}

export function describeBounds(bounds: Bounds | null): BoundsOutput | null {
  if (!bounds) return null;
  return {
    west: round5(bounds[0]),
    south: round5(bounds[1]),
    east: round5(bounds[2]),
    north: round5(bounds[3]),
  };
}

export function describeDrawing(drawing: Drawing): DrawingOutput {
  const out: DrawingOutput = { id: drawing.id, kind: drawing.kind, source: drawing.source };
  if (drawing.label) out.label = drawing.label;
  // Measuring here (rather than at draw time) also covers the shapes the human
  // drew by hand, which never went through a tool.
  return { ...out, ...measureGeometry(drawing.geometry) };
}

export function describeAnnotation(annotation: Annotation): AnnotationOutput {
  return {
    id: annotation.id,
    note: truncate(annotation.note, NOTE_PREVIEW_CHARS),
    source: annotation.source,
  };
}

/**
 * The one state object the agent ever needs: what the camera shows, what is
 * highlighted, how much data is loaded, and what has been drawn or noted on the
 * map by either side. Every write tool returns it so no follow-up read is
 * required.
 */
export function describeState(store: MapToolStore): MapStateOutput {
  const selection = store.getSelection();
  const drawings = store.getDrawings();
  const annotations = store.getAnnotations();
  // Read, never fetched: state is returned by every write tool and by the page,
  // and a state read that went to the network would make tier-2 something a
  // page pays for without ever asking for it.
  const loaded = store.getLoadedCategories();
  const available = store.getTier2Manifest()?.categories.length ?? 0;
  const loading = store.getPendingCategories();
  const failed = store.getRestoreFailures();
  const tier2: Tier2StateOutput = {
    loaded: [...loaded],
    available,
    ...(loading.length ? { loading: [...loading] } : {}),
    // Field by field, not a spread: `permanent` decides what a link this page
    // hands on declares, which is the store's business and not an answer to the
    // question the agent asked. The reason is already in `error`.
    ...(failed.length
      ? { failed: failed.map((f) => ({ category: f.category, error: f.error })) }
      : {}),
  };
  return {
    ...describeView(store.getView()),
    bounds: describeBounds(store.getBounds()),
    selection: { count: selection.length, ids: selection.slice(0, SELECTION_ID_LIMIT) },
    features_loaded: store.getFeatures().length,
    // A page that never touched tier-2 reports exactly the state it always did;
    // a link still loading its categories, or one that failed to, is state in
    // its own right and says so even before a single feature has arrived.
    ...(loaded.length || available || loading.length || failed.length ? { tier2 } : {}),
    drawings: {
      count: drawings.length,
      items: drawings.slice(-STATE_ITEM_LIMIT).map(describeDrawing),
    },
    annotations: {
      count: annotations.length,
      items: annotations.slice(-STATE_ITEM_LIMIT).map(describeAnnotation),
    },
  };
}
