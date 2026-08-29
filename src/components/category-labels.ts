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

/**
 * Legend chips. "Listings (sample)" is a disclosure, not decoration: the
 * listings are the one fabricated dataset on the map, and since the labels on
 * the map itself only appear from z14 the legend is the only place a viewer of
 * the opening view is told. It must stay wherever the full label is shown.
 */
export const CATEGORY_PLURAL: Record<FeatureCategory, string> = {
  park: "Parks",
  supermarket: "Supermarkets",
  school: "Schools",
  mrt_station: "MRT",
  listing: "Listings (sample)",
  district: "Districts",
};

/**
 * Abbreviation used only when the legend strip runs out of room (≤1360px).
 * Undefined means the full word always fits. The popover keeps the full label,
 * so dropping "(sample)" here loses nothing: the strip collapses into that
 * popover below 1241px.
 */
export const CATEGORY_PLURAL_SHORT: Partial<Record<FeatureCategory, string>> = {
  supermarket: "Markets",
  listing: "Listings",
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
