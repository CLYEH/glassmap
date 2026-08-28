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
}
