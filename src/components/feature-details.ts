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
 * nothing in the card or the sidebar has to change. T-97 is the seam being
 * used as designed: the extract gained eleven more tags and
 * `get_place_details` gained the ability to say all of them, so eleven lines
 * went in below and the card grew.
 */
import { truncate } from "@/lib/map-tools/shapes";
import type { MapFeatureProperties, Tier2TextField } from "@/lib/store/tier2";

/**
 * The OSM tags this page knows how to show — every tag the store carries, which
 * is what parity means. The alias rather than a second hand-written union:
 * `TIER2_TEXT_FIELDS` is already the one list the parser, the type and
 * `get_place_details` agree on, and a fourth copy here is a fourth place for a
 * new tag to be forgotten. `DETAIL_FIELDS` below still decides the order and
 * the words, and `feature-details.test.ts` holds it complete against that list.
 */
export type DetailField = Tier2TextField;

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
  /**
   * The value as a URL a browser may follow, present only where it *is* one and
   * `link` is set for the field. Absent leaves the row plain text — which is
   * what an unparseable or non-web value gets, never a silent drop.
   */
  href?: string;
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
export const DETAIL_FIELDS: readonly {
  field: DetailField;
  label: string;
  dedupe?: true;
  link?: true;
}[] = [
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

  // --- T-97: how to get there, and how to reach it ------------------------
  { field: "address", label: "Address" },
  { field: "phone", label: "Phone" },
  // The one row that is a link rather than a string, and the reason is the
  // clip. Every other value survives being folded at DETAIL_CHARS — half an
  // address still names the street, half a phone number still says which
  // country. Half a URL is nothing at all: it cannot be typed, it cannot be
  // copied out of a `title` tooltip, and 25% of the 2,934 websites in the
  // shipped extract are longer than the fold (median 26 characters, p90 45).
  // So the text stays the raw value, clipped like everything else, and the
  // href carries the whole of it — the visible string is still what OSM says,
  // and the click is what the human came for. `linkHref` decides what may
  // become an href; `OnTheMapCard` adds rel="noopener noreferrer" and opens a
  // new tab, because navigating this tab away would tear down the map (and
  // any agent session working on it) to read a menu.
  { field: "website", label: "Website", link: true },
  // The raw OSM value — "yes", "no", "limited" — under a label that names the
  // tag, and nothing else. This page does not turn `wheelchair=yes` into
  // "wheelchair accessible": the first reports what one mapper recorded, the
  // second asserts a fact nobody here verified, about a door somebody may be
  // relying on. The repo's no-accessibility-claims rule governs the words on
  // the page exactly as it governs the pitch, and "limited" is the value that
  // proves the point — there is no honest English sentence this layer could
  // expand it into. `src/lib/data/tier2.test.ts` holds the shipped files to
  // those three values, so the row is a tag echo end to end.
  { field: "wheelchair", label: "Wheelchair" },

  // --- T-97: what this kind of place is asked about -----------------------
  // One category each (`TIER2_TEXT_FIELDS`), so a place carrying one of these
  // is a fact about that place rather than an artefact of the schema. Same
  // treatment as everything above: the tag's own value, a noun for a label,
  // no interpretation. "Fee: yes" is a car park that charges; what it charges
  // is not in the data, and the row does not pretend otherwise.
  { field: "stars", label: "Stars" },
  { field: "fee", label: "Fee" },
  { field: "capacity", label: "Capacity" },
  { field: "dispensing", label: "Dispensing" },
  { field: "religion", label: "Religion" },
  { field: "denomination", label: "Denomination" },
  { field: "emergency", label: "Emergency" },
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
 * An OSM tag value as a URL this page is willing to put in an `href`, or
 * undefined.
 *
 * The allow-list is the whole function and it is a security boundary, not a
 * tidiness one: `website` is arbitrary text from an open, editable database,
 * `new URL("javascript:alert(1)")` parses happily with `protocol` set to
 * `javascript:`, and React will render that string into an `href` given the
 * chance. Two schemes are followed, and a value that is anything else — a
 * `data:` payload, a `mailto:`, or the one entry in the shipped extract that is
 * a pasted Google result with a "›" in it — comes back undefined and the row
 * degrades to the plain text it would have been anyway. Nothing is hidden by
 * refusing a link; the value is still printed.
 *
 * `url.href` rather than the input string, so what the browser is handed is the
 * parser's own normalised, percent-encoded form. What the human *reads* stays
 * the raw tag (`DetailRow.text` / `.full`).
 */
export function linkHref(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Bare "www.example.com" lands here too. Guessing a scheme for it would be
    // guessing http versus https for somebody else's server; the text stands.
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
}

/**
 * The tags of one feature, in `DETAIL_FIELDS` order, ready to render.
 *
 * Absent means absent: a tag the source does not carry produces no row at all,
 * never an empty label. Coverage over the shipped extract (31,069 features in
 * public/data/tier2/**) is address 43%, brand 31%, opening_hours 25%, cuisine
 * 22%, phone 22%, wheelchair 14%, website 9%, and every category-gated tag
 * under 4% (religion 3.5%, fee 2.1%, capacity 0.7%, dispensing and denomination
 * 0.4%, stars and emergency 0.1%). So a missing tag is overwhelmingly the
 * common case — a blank-label layout would be the shape most cards take, and
 * 8,265 of those features have no tag at all and get no section.
 *
 * The richest place in the extract carries seven of the fourteen, and nothing
 * carries more, so the tallest card this can build is bounded by the data
 * rather than by a cap here. That matters because the card decides which side
 * of the tap it hangs on from its own measured height (`cardPlacement`), which
 * is exactly the arrangement that lets this table grow without a second
 * number needing to be updated somewhere else.
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
  for (const { field, label, dedupe, link } of DETAIL_FIELDS) {
    const value = properties[field]?.trim();
    if (!value) continue;
    if (dedupe && names.some((name) => name && sameText(name, value))) continue;
    const href = link ? linkHref(value) : undefined;
    rows.push({
      field,
      label,
      text: truncate(value, DETAIL_CHARS),
      full: value,
      ...(href ? { href } : {}),
    });
  }
  return rows;
}
