import { isFeatureCategory, type FeatureCategory } from "@/lib/data/schema";
import type { MapCategory, Tier2Category } from "@/lib/store/tier2";

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
 * Key chips. "Listings (sample)" is a disclosure, not decoration: the listings
 * are the one fabricated dataset on the map, and since the labels on the map
 * itself only appear from z14 the key in the Places tray is the only place a
 * viewer is told. It must stay wherever the full label is shown.
 */
export const CATEGORY_PLURAL: Record<FeatureCategory, string> = {
  park: "Parks",
  supermarket: "Supermarkets",
  school: "Schools",
  mrt_station: "MRT",
  listing: "Listings (sample)",
  district: "Districts",
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

/**
 * The 18 point-of-interest categories, in their own map rather than folded
 * into `CATEGORY_SINGULAR`.
 *
 * Two reasons it stays separate. `CATEGORY_SINGULAR` is a
 * `Record<FeatureCategory, …>` on purpose — it is what makes the compiler
 * name the file the day a seventh bundled dataset lands — and widening it to
 * `MapCategory` would trade that check for nothing. And the two vocabularies
 * are not the same kind of thing: the six are datasets this map draws and the
 * legend colours; these 18 are OSM tag values that arrive on demand and have
 * no colour at all. `Record<Tier2Category, …>` gives this half the identical
 * exhaustiveness guarantee against `TIER2_CATEGORIES`.
 *
 * The wording is the plain-English reading of each OSM tag (see
 * public/data/README.md for the queries), not the tag itself: a person reading
 * a selected row wants "Convenience store", while the agent's own vocabulary —
 * the enum value it must pass back — is shown verbatim and in mono by the
 * loaded-categories disclosure.
 */
export const TIER2_SINGULAR: Record<Tier2Category, string> = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  fast_food: "Fast food",
  bakery: "Bakery",
  bar: "Bar",
  convenience: "Convenience store",
  pharmacy: "Pharmacy",
  clinic: "Clinic",
  hospital: "Hospital",
  place_of_worship: "Place of worship",
  bank: "Bank",
  hotel: "Hotel",
  parking: "Parking",
  bicycle_rental: "Bike share",
  library: "Library",
  museum: "Museum",
  post_office: "Post office",
  police: "Police station",
};

/**
 * The same 18, as a person browsing them would read them: the Places tray is a
 * list of *kinds of place*, so its rows are plural where English pluralises
 * them and mass nouns where it does not ("Parking", "Convenience", "Worship").
 *
 * Separate from `TIER2_SINGULAR` rather than derived from it because "Bakery"
 * → "Bakeries" and "Place of worship" → "Worship" are not one rule, and a
 * pluraliser that got them right would still be a function nobody could read
 * the output of without running it. Same `Record<Tier2Category, …>`
 * exhaustiveness: a nineteenth category cannot be added without a word for it
 * here.
 */
export const TIER2_PLURAL: Record<Tier2Category, string> = {
  restaurant: "Restaurants",
  cafe: "Cafés",
  fast_food: "Fast food",
  bakery: "Bakeries",
  bar: "Bars",
  convenience: "Convenience",
  pharmacy: "Pharmacies",
  clinic: "Clinics",
  hospital: "Hospitals",
  place_of_worship: "Worship",
  bank: "Banks",
  hotel: "Hotels",
  parking: "Parking",
  bicycle_rental: "Bike share",
  library: "Libraries",
  museum: "Museums",
  post_office: "Post offices",
  police: "Police",
};

/**
 * The human label for any category a loaded feature can carry. Total over
 * `MapCategory`, so a selected row always has a word for what it is — the one
 * thing a row must never be missing is what kind of place it names.
 */
export function categorySingular(category: MapCategory): string {
  return isFeatureCategory(category) ? CATEGORY_SINGULAR[category] : TIER2_SINGULAR[category];
}
