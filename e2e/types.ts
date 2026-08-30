/**
 * Loose shape of a GlassMap tool result once its JSON string return value is
 * parsed. Mirrors the local `ToolResult` in
 * src/lib/map-tools/map-tools.test.ts so e2e assertions never need `any`.
 * Every field is optional: which ones are present depends on which tool ran
 * and whether it errored.
 */
export interface ToolResult {
  error?: string;
  candidates?: PlaceCandidateResult[];
  total?: number;
  returned?: number;
  features?: FeatureResult[];
  selected?: FeatureResult[];
  unknown_ids?: string[];
  unknown_count?: number;
  state?: MapStateResult;
  // get_map_state / set_map_view success responses flatten MapStateResult here.
  center?: { lng: number; lat: number };
  zoom?: number;
  bearing?: number;
  pitch?: number;
  bounds?: BoundsResult | null;
  selection?: { count: number; ids: string[] };
  features_loaded?: number;
  /** Absent until something has touched tier-2 at all (see state.ts). */
  tier2?: Tier2StateResult;
  drawings?: { count: number; items: DrawingResult[] };
  annotations?: { count: number; items: AnnotationResult[] };
  // draw_shape / annotate / get_share_link success responses.
  drawing_id?: string;
  annotation_id?: string;
  area_m2?: number;
  length_m?: number;
  url?: string;
  bytes?: number;
  omitted?: { drawings: number; annotations: number };
  // Tier-2 (T-62/T-63): present on find_features / select_features /
  // list_features_in_view answers that left something city-wide unsearched,
  // and (matched) on a select_features refusal over SELECT_MATCH_LIMIT.
  searched_categories?: string[];
  unsearched_categories?: UnsearchedCategoryResult[];
  category_counts?: Record<string, number>;
  matched?: number;
}

/** A category that exists city-wide but was not part of this answer. */
export interface UnsearchedCategoryResult {
  category: string;
  /** From the manifest: how many exist in the whole city, without loading any. */
  citywide_count: number;
}

/** The point-of-interest slice of map state; see `state.ts`'s Tier2StateOutput. */
export interface Tier2StateResult {
  /** Sorted category names whose features are loaded, city-wide. */
  loaded: string[];
  /** How many categories the index offers in total. */
  available: number;
  /** Categories a share link this page was opened with is still fetching. */
  loading?: string[];
  /** Categories a share link declared that this page could not load, and why. */
  failed?: { category: string; error: string }[];
}

export interface DrawingResult {
  id: string;
  kind: "circle" | "polygon" | "line";
  label?: string;
  /** "user" means a human drew it by hand; "agent" means a tool did. */
  source: "agent" | "user";
  area_m2?: number;
  length_m?: number;
}

export interface AnnotationResult {
  id: string;
  note: string;
  source: "agent" | "user";
}

export interface FeatureResult {
  id: string;
  name: string;
  name_en?: string;
  category: string;
  sample?: boolean;
  distance_m?: number;
  direction?: string;
}

export interface PlaceCandidateResult {
  id: string;
  name: string;
  name_en?: string;
  category: string;
  distance_m?: number;
}

export interface BoundsResult {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapStateResult {
  center: { lng: number; lat: number };
  zoom: number;
  bearing: number;
  pitch: number;
  bounds: BoundsResult | null;
  selection: { count: number; ids: string[] };
  features_loaded: number;
  /** Absent until something has touched tier-2 at all (see state.ts). */
  tier2?: Tier2StateResult;
  drawings: { count: number; items: DrawingResult[] };
  annotations: { count: number; items: AnnotationResult[] };
}
