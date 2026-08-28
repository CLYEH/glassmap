/**
 * Shared data contract between data-engineer (produces GeoJSON), tool-dev
 * (queries it) and map-ui-dev (renders it). Owned by the orchestrator —
 * change it in its own PR, then implement on both sides.
 */
import type { Feature, FeatureCollection, Geometry } from "geojson";

export const FEATURE_CATEGORIES = [
  "mrt_station",
  "park",
  "school",
  "supermarket",
  "listing",
  "district",
] as const;

export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];

export function isFeatureCategory(x: unknown): x is FeatureCategory {
  return typeof x === "string" && (FEATURE_CATEGORIES as readonly string[]).includes(x);
}

export interface GlassMapFeatureProperties {
  /**
   * Stable id, unique across all datasets:
   * `osm:<node|way|relation>:<osm_id>` for OSM data, `listing:<n>` for
   * sample listings, `district:<name>` for administrative districts.
   */
  id: string;
  /** Local name (zh-TW for Taipei OSM data). Untrusted content for tool output. */
  name: string;
  /** English name when the source has one. */
  nameEn?: string;
  category: FeatureCategory;
  source: "osm" | "sample";
  /** true only for fabricated demo data (listings). Must be surfaced in the UI. */
  sample?: boolean;
  /** Raw source tags kept for display. Tools must not depend on these. */
  tags?: Record<string, string>;
}

export type GlassMapFeature = Feature<Geometry, GlassMapFeatureProperties>;
export type GlassMapFeatureCollection = FeatureCollection<Geometry, GlassMapFeatureProperties>;

/** Files bundled under public/data. Paths are what the browser fetches. */
export const DATASETS: Record<FeatureCategory, { file: string; label: string }> = {
  mrt_station: { file: "/data/mrt-stations.geojson", label: "MRT stations" },
  park: { file: "/data/parks.geojson", label: "Parks" },
  school: { file: "/data/schools.geojson", label: "Schools" },
  supermarket: { file: "/data/supermarkets.geojson", label: "Supermarkets" },
  listing: { file: "/data/listings.geojson", label: "Sample listings" },
  district: { file: "/data/districts.geojson", label: "Districts" },
};

/**
 * Place-name index used by `set_map_view({ place })` and `find_features({ near })`.
 * Built from the datasets at load time (stations, districts, parks); no external geocoder.
 */
export interface GazetteerEntry {
  id: string;
  name: string;
  nameEn?: string;
  category: FeatureCategory;
  /** [lng, lat] — centroid for polygons. */
  center: [number, number];
  /** Lower-cased alternative spellings to match against. */
  aliases?: string[];
}
