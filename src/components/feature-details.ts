/**
 * What a place *is*, beyond its name — the OSM tags a human is allowed to read
 * off the page.
 *
 * The tools have returned `cuisine`, `brand` and `opening_hours` on every POI
 * answer since they shipped (`lib/map-tools/output.ts`, `describeFeature`), and
 * until this module existed the human's own surfaces showed none of them: the
 * agent could say "vegetarian, open till nine" while the card under the human's
 * finger said only a name. Parity is the point of this page — whatever a tool
 * can read, the person sitting in front of it must be able to see — so both
 * surfaces now read the same tags out of the same table.
 *
 * The table is the seam. A new tag becomes visible by adding one line to
 * `DETAIL_FIELDS` (and to `MapFeatureProperties`, which the tool layer owns);
 * nothing in the card or the sidebar has to change.
 */
import { truncate } from "@/lib/map-tools/shapes";
import type { MapFeatureProperties } from "@/lib/store/tier2";

/** The OSM tags this page knows how to show. Add here, and the card follows. */
export type DetailField = "cuisine" | "brand" | "opening_hours";

/** One labelled tag, ready to render. */
export interface DetailRow {
  /** The OSM tag it came from; also the row's `data-field`. */
  field: DetailField;
  /** The word above it, in the page's own English. */
  label: string;
  /** What the row shows: the raw value, clipped to fit a card. */
  text: string;
  /** The whole raw value, for `title=` — nothing is ever hidden, only folded. */
  full: string;
}

/**
 * The order, which is an editorial call rather than the data's: what the place
 * serves, whose sign is over the door, when you can go.
 *
 * `dedupe` is opt-in and, today, `brand` only. A brand is the one tag that
 * *is* a name — it repeats the headline for 6,844 of the 9,631 branded POIs in
 * the extract — and that is a property of what the tag means, not of how it
 * happens to be spelled. Applied to every field it would be a silent
 * data-dependent bug waiting for T-97: a `wheelchair: "yes"` dropped from a
 * cafe called "Yes" removes a fact somebody plans their afternoon around. A
 * new field opts in only if it is another name for the place.
 */
const DETAIL_FIELDS: readonly { field: DetailField; label: string; dedupe?: true }[] = [
  { field: "cuisine", label: "Cuisine" },
  { field: "brand", label: "Brand", dedupe: true },
  // No opening_hours parser, deliberately, and this is the decision rather than
  // an omission: the OSM syntax has months, weeks, holidays, sunset offsets and
  // exceptions, and a parser that gets one of them wrong tells a human "open"
  // about a shop with its shutters down. A wrong "open now" is worse than the
  // raw string — the raw string is at least visibly something to read for
  // yourself. So the value is shown verbatim, clipped for the card's width,
  // with the whole of it on hover. If this ever needs to say "open now", it
  // needs a maintained library and a source date, not a regex.
  { field: "opening_hours", label: "Hours" },
];

/**
 * How much of a tag value the card shows before it folds. Two lines of the
 * card's detail column at 11px; the rest is one hover away.
 */
export const DETAIL_CHARS = 36;

/**
 * Two strings a person would read as the same words. Used to keep a name from
 * being printed twice — an English name identical to the local one, a `brand`
 * identical to the name over it (673 of the 682 branded cafes in the shipped
 * extract, and 2911 of 2919 convenience stores).
 *
 * Case and surrounding space only. Nothing here transliterates, folds scripts
 * or normalises punctuation: "7-ELEVEN" and "7-Eleven" are the same sign, while
 * "星巴克" and "Starbucks" are two different things to read and both stay.
 */
export function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The tags of one feature, in `DETAIL_FIELDS` order, ready to render.
 *
 * Absent means absent: a tag the source does not carry produces no row at all,
 * never an empty label. Coverage over the shipped extract (31,068 features in
 * public/data/tier2/**) is 22% cuisine, 31% brand, 25% opening_hours, so a
 * missing tag is the common case and a blank-label layout would be the shape
 * most cards take.
 *
 * `names` are the names the surface has already printed, and they are compared
 * against the `dedupe` fields only — `brand`. A brand equal to the headline is
 * dropped because the human is already looking at that string: "Brand
 * 7-ELEVEN" under the headline "7-ELEVEN" adds a row and no information, and
 * nothing is hidden by it. No other tag is a name, so no other tag is silenced
 * by matching one.
 *
 * `Partial<MapFeatureProperties>` rather than the tier-2 type itself, so the six
 * bundled datasets can be passed through the same call and simply produce
 * nothing — they carry none of these tags.
 */
export function featureDetails(
  properties: Partial<MapFeatureProperties>,
  names: readonly string[] = [],
): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const { field, label, dedupe } of DETAIL_FIELDS) {
    const value = properties[field]?.trim();
    if (!value) continue;
    if (dedupe && names.some((name) => name && sameText(name, value))) continue;
    rows.push({ field, label, text: truncate(value, DETAIL_CHARS), full: value });
  }
  return rows;
}
