import type { FeatureCategory } from "@/lib/data/schema";

/**
 * Display names for the chrome. `CATEGORY_LABEL` (map-style.ts) stays the
 * dataset's own label — "MRT stations", "Sample listings" — which is the right
 * thing for a dataset and too long for a legend chip.
 */

/** Legend order: descending by count in the bundled data, as the design reads. */
export const LEGEND_ORDER: readonly FeatureCategory[] = [
  "park",
  "supermarket",
  "school",
  "mrt_station",
  "listing",
  "district",
];

/** Legend chips. */
export const CATEGORY_PLURAL: Record<FeatureCategory, string> = {
  park: "Parks",
  supermarket: "Supermarkets",
  school: "Schools",
  mrt_station: "MRT",
  listing: "Listings",
  district: "Districts",
};

/**
 * Abbreviation used only when the legend strip runs out of room (≤1360px).
 * Undefined means the full word always fits.
 */
export const CATEGORY_PLURAL_SHORT: Partial<Record<FeatureCategory, string>> = {
  supermarket: "Markets",
};

/** One selected feature is a "Park", not "Parks". */
export const CATEGORY_SINGULAR: Record<FeatureCategory, string> = {
  park: "Park",
  supermarket: "Supermarket",
  school: "School",
  mrt_station: "MRT",
  listing: "Listing",
  district: "District",
};
