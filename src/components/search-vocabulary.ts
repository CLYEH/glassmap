import { normaliseName } from "@/lib/map-tools/gazetteer";
import type { MapCategory, Tier2Category } from "@/lib/store/tier2";
import { TIER2_PLURAL } from "./category-labels";

/**
 * The words a person uses for a *kind* of place, in the two languages this city
 * is written in.
 *
 * The search box answers "where is X" out of names. This table answers the other
 * half of the question a person actually arrives with: sometimes X is not a
 * place at all, it is a category — "coffee", "pharmacy", "parking", and the same
 * three words in Chinese — and the honest answer is not a list of eight cafés
 * but the offer to put every café on the map. Without it the box searched
 * 31,000 names for the Chinese word for pharmacy and found the handful of shops
 * that happen to be *called* that, over a city holding 1,100 of them.
 *
 * Three rules keep the table from becoming a search engine of its own:
 *
 *  - **Category concepts only.** A kind of place, never a kind of food: ramen,
 *    sushi and vegetarian are `cuisine` tag values, and the feature matcher
 *    already finds them on the places that carry them (`search-model.ts`).
 *    Putting them here would offer to paint 12,000 restaurants because somebody
 *    typed "ramen", which is not what they asked and not where the answer is.
 *  - **Common Taiwanese usage, not translation.** Every alias is a word people
 *    in Taipei actually type — the contraction for a convenience store, the
 *    neighbourhood word for a police post, "ubike" for the bike share the city
 *    runs. A dictionary-correct word nobody says earns nothing and costs a
 *    false match.
 *  - **English aliases where the label cannot be typed.** `TIER2_PLURAL` is the
 *    tray's own wording and it is matched as-is, but matching is by prefix, so
 *    a plural the language does not build by adding a letter is unreachable
 *    from its own singular: "Pharmacies" is not reached by "pharmacy",
 *    "Bakeries" not by "bakery", "Cafés" not even by "cafe" (the accent is a
 *    different character and `normaliseName` does not fold accents). The map
 *    shows those singulars itself — `TIER2_SINGULAR` is what a selected row
 *    says — so a person types back a word the app taught them, and it has to
 *    work. The test file pins that: every word this app uses for a kind reaches
 *    that kind. Those gaps are aliases, never a change to the tray's words.
 *
 * It lives in the components layer because it is chrome vocabulary, exactly like
 * `TIER2_PLURAL`: no tool takes these words, no tool answers in them, and an
 * agent that named a category typed its enum value. The one thing that crosses
 * into shared state when a row is picked is the category load itself.
 */
export interface CategoryVocabularyEntry {
  category: Tier2Category;
  /** The tray's own English word for the kind (`TIER2_PLURAL`). */
  en: string;
  /** The word a person in Taipei would type for it. */
  zh: string;
  /** Other words for the same kind, in either language. */
  aliases: readonly string[];
}

/**
 * The 18 kinds, with the words that reach them.
 *
 * Notes on the choices a reader who does not live here cannot check:
 *  - `cafe`: the two-character word for coffee is what gets typed on its own;
 *    the shop words are what it is completed to.
 *  - `convenience`: the two-character contraction is the ordinary spoken word,
 *    more common than the full four-character name. Chain names (7-Eleven,
 *    FamilyMart) are brands, matched on the places themselves and not here.
 *  - `place_of_worship`: one OSM tag covers temples, shrines and churches, so
 *    the row has to be reachable from all three, including the single character
 *    that is the most-typed of them.
 *  - `bicycle_rental`: in Taipei this category *is* YouBike — the Chinese name
 *    the city uses, and "ubike", the older and still universal one.
 *  - `hotel`: two words are current, and one of them also ends restaurant
 *    names. Harmless: a restaurant with that ending is found by the feature
 *    matcher above this row, not instead of it.
 *  - `bank`: no ATM alias. This map holds bank branches, and offering "browse
 *    Banks" for "atm" would promise cash machines the data does not have.
 */
export const CATEGORY_VOCABULARY: readonly CategoryVocabularyEntry[] = [
  { category: "restaurant", en: TIER2_PLURAL.restaurant, zh: "餐廳", aliases: ["餐館", "吃飯", "小吃"] },
  { category: "cafe", en: TIER2_PLURAL.cafe, zh: "咖啡廳", aliases: ["咖啡", "咖啡店", "cafe", "coffee"] },
  { category: "fast_food", en: TIER2_PLURAL.fast_food, zh: "速食", aliases: ["速食店", "快餐"] },
  { category: "bakery", en: TIER2_PLURAL.bakery, zh: "麵包店", aliases: ["麵包", "烘焙", "bakery"] },
  { category: "bar", en: TIER2_PLURAL.bar, zh: "酒吧", aliases: ["酒館", "小酒館", "pub"] },
  {
    category: "convenience",
    en: TIER2_PLURAL.convenience,
    zh: "便利商店",
    aliases: ["超商", "便利店", "convenience store"],
  },
  { category: "pharmacy", en: TIER2_PLURAL.pharmacy, zh: "藥局", aliases: ["藥房", "西藥房", "pharmacy", "drugstore"] },
  { category: "clinic", en: TIER2_PLURAL.clinic, zh: "診所", aliases: ["門診", "衛生所"] },
  { category: "hospital", en: TIER2_PLURAL.hospital, zh: "醫院", aliases: ["急診", "醫學中心"] },
  {
    category: "place_of_worship",
    en: TIER2_PLURAL.place_of_worship,
    zh: "廟宇",
    aliases: ["廟", "寺廟", "教堂", "temple", "place of worship"],
  },
  { category: "bank", en: TIER2_PLURAL.bank, zh: "銀行", aliases: ["分行"] },
  { category: "hotel", en: TIER2_PLURAL.hotel, zh: "飯店", aliases: ["旅館", "酒店", "住宿"] },
  { category: "parking", en: TIER2_PLURAL.parking, zh: "停車場", aliases: ["停車", "car park"] },
  {
    category: "bicycle_rental",
    en: TIER2_PLURAL.bicycle_rental,
    zh: "自行車租借",
    aliases: ["ubike", "youbike", "微笑單車", "腳踏車"],
  },
  { category: "library", en: TIER2_PLURAL.library, zh: "圖書館", aliases: ["圖書室", "library"] },
  { category: "museum", en: TIER2_PLURAL.museum, zh: "博物館", aliases: ["美術館", "展覽館", "museum"] },
  { category: "post_office", en: TIER2_PLURAL.post_office, zh: "郵局", aliases: ["郵政", "post office"] },
  { category: "police", en: TIER2_PLURAL.police, zh: "警察局", aliases: ["派出所", "分局", "police station"] },
];

/** One "browse this kind" row. */
export interface CategoryRow {
  category: Tier2Category;
  /** The English word, as the tray shows it. */
  label: string;
  /** The Chinese word, beside it — the map is read in both. */
  zh: string;
  /**
   * How many exist city-wide, from the manifest, or null when the manifest has
   * not arrived. Null renders as "…", the tray's own "not counted yet": a zero
   * would be a claim about a file nobody has counted.
   */
  count: number | null;
}

/**
 * How many kinds one query may offer. Two, because this is the *third* answer
 * on a list that already holds places a person can go to — it is a suggestion
 * under the results, and a query matching four kinds ("b") has not identified a
 * kind at all.
 */
export const SEARCH_CATEGORY_LIMIT = 2;

/**
 * Below this many characters a Latin query is a keystroke on the way to a word,
 * not a word: "b" prefixes Bakeries, Banks, Bars and Bike share, and offering to
 * paint two of them is noise. A single Han character *is* a whole word — the
 * one for temple is in this table — so it is exempt, which is the only reason
 * this function looks at the shape of the text at all. The range is CJK Unified
 * Ideographs, written in escapes so the rule is legible in any editor.
 */
const MIN_LATIN_LENGTH = 2;
const HAN = /[\u4e00-\u9fff]/;

interface Term {
  entry: CategoryVocabularyEntry;
  /** Every word that reaches this entry, folded once at module load. */
  terms: readonly string[];
}

/**
 * Folded once, here, rather than per keystroke — the same reason the citywide
 * index has a precomputed haystack (`search-index-model.ts`). It is only 90
 * strings, but a table normalised inside the matcher is a table normalised
 * eighteen times a keystroke for no gain.
 */
const TERMS: readonly Term[] = CATEGORY_VOCABULARY.map((entry) => ({
  entry,
  terms: [entry.en, entry.zh, ...entry.aliases].map(normaliseName).filter(Boolean),
}));

export interface CategoryMatchInput {
  /** Raw, as typed. */
  query: string;
  /** Citywide counts from `/data/tier2/index.json`; empty until it arrives. */
  counts: ReadonlyMap<MapCategory, number>;
  /**
   * Kinds already painted on the map. Offering to browse what is already
   * browsed is an offer to do nothing — and picking it would toggle the
   * category *off*, which is the opposite of what the row says.
   */
  painted: readonly Tier2Category[];
  limit?: number;
}

/**
 * The kinds this query names, best first.
 *
 * Matching is **prefix**, not substring: a person types the beginning of a word,
 * and "an" must not offer to paint every restaurant because 餐廳's English label
 * happens to contain those letters somewhere. Prefix also means the row appears
 * while the word is still being typed ("咖" → 咖啡廳), which is what makes it an
 * offer rather than a result.
 *
 * Order: a term typed in full comes first — somebody who typed "咖啡" exactly
 * means cafés, whatever else starts with it — then the bigger kind, on the same
 * reasoning `unloadedMatches` ranks its disclosure (more matches is the more
 * likely thing meant), then the category name so two runs never disagree.
 */
export function matchCategoryVocabulary(input: CategoryMatchInput): CategoryRow[] {
  const needle = normaliseName(input.query);
  if (!needle) return [];
  if (needle.length < MIN_LATIN_LENGTH && !HAN.test(needle)) return [];

  const painted = new Set(input.painted);
  const matched: { entry: CategoryVocabularyEntry; exact: boolean; count: number }[] = [];
  for (const { entry, terms } of TERMS) {
    if (painted.has(entry.category)) continue;
    if (!terms.some((term) => term.startsWith(needle))) continue;
    matched.push({
      entry,
      exact: terms.includes(needle),
      count: input.counts.get(entry.category) ?? 0,
    });
  }

  matched.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      b.count - a.count ||
      a.entry.category.localeCompare(b.entry.category),
  );

  return matched.slice(0, input.limit ?? SEARCH_CATEGORY_LIMIT).map(({ entry }) => ({
    category: entry.category,
    label: entry.en,
    zh: entry.zh,
    count: input.counts.get(entry.category) ?? null,
  }));
}
