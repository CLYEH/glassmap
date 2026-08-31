/**
 * The citywide name index: one flat row per tier-2 point of interest, covering
 * all 18 categories whether or not any of them is in memory.
 *
 * It exists because of a defect the category-lazy design creates and cannot
 * fix on its own: a search for "starbucks" on a fresh page finds nothing,
 * because no category is loaded yet, even though 152 Starbucks stores are
 * sitting in `cafe.geojson`. Nothing on screen contradicts that answer — which
 * is the exact failure mode `tier2.ts` was written to prevent, one level up.
 * The index is how a search can say *what it could have found*, without
 * fetching a single category file.
 *
 * Three things it deliberately is not:
 *
 *  - **Not a category.** `/data/tier2/index.json`'s manifest lists exactly the
 *    18 categories a tool schema can name, and two regression tests hold it to
 *    that set (`src/lib/data/tier2.test.ts`, `src/lib/store/tier2.test.ts`).
 *    So this file is fetched by its literal path and never through the
 *    manifest — see public/data/README.md, "Citywide search index (T-100)".
 *  - **Not features.** A row is a name, a kind, a position and the categories
 *    the id lives in. Nothing here is added to `getFeatures()`, nothing here is
 *    rendered, and nothing here can be selected: an id found in the index and
 *    not in memory is a reason to load a category, not a feature to answer
 *    with. Loading it silently would make what is on the map depend on what was
 *    searched for, which is the determinism `tier2.ts` protects.
 *  - **Not required.** Every consumer degrades to saying nothing when the index
 *    is missing, still loading or unreadable. A deployment that does not ship
 *    the file behaves exactly as it did before T-100.
 */
import {
  isMapCategory,
  isPermanentFetchError,
  type FetchJson,
  type MapCategory,
} from "./tier2";

/** Where the index lives. Literal, because it is not in the manifest — see above. */
export const SEARCH_INDEX_URL = "/data/tier2/search-index.json";

/**
 * One point of interest, as the index knows it. The fields are the tuple
 * columns of public/data/README.md's "Shape" table, named; absent columns
 * (`""` on the wire) are absent here rather than empty, so a caller can never
 * match a query against a string the source did not have.
 *
 * `lng`/`lat` are copied, not re-rounded: the generator writes them at 5
 * decimals already, and a second rounding rule in a second place is how the
 * index and the category file it was derived from would start disagreeing
 * about where a place is.
 */
export interface SearchIndexEntry {
  id: string;
  name: string;
  nameEn?: string;
  brand?: string;
  cuisine?: string;
  address?: string;
  /** Every category file this id appears in; sorted, at least one. */
  categories: MapCategory[];
  lng: number;
  lat: number;
}

/**
 * What this page knows about the index, as five distinguishable answers.
 *
 * The distinctions all earn their place by changing what a surface may say or
 * do:
 *
 *  - `idle` — nobody has asked. Not the same as "there is none": a page that
 *    has never searched must not report the index as missing.
 *  - `loading` — a request is in flight; a consumer waits or says nothing.
 *  - `ready` — `getSearchIndex()` returns rows (possibly zero of them, which
 *    is an empty index and not a failure).
 *  - `failed` — a moment went badly: a 5xx, a dropped connection, a document
 *    that could not be read. The next `loadSearchIndex()` tries again, because
 *    one bad second must not cost the rest of the session its citywide search.
 *  - `absent` — this deployment ships no index (a 4xx). Asking again cannot
 *    change that answer, so it is never asked again. Same rule, and the same
 *    reason, as the tier-2 manifest's `manifestAbsent` latch: without it every
 *    query-bearing tool call would re-request the same missing file, once per
 *    question, for the life of the tab.
 */
export type SearchIndexStatus = "idle" | "loading" | "ready" | "failed" | "absent";

const isRec = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const str = (x: unknown): string | undefined =>
  typeof x === "string" && x.trim() ? x : undefined;

/** How many columns a row must have. Positions are the contract; see the README. */
const ROW_COLUMNS = 9;

const inRange = (x: unknown, limit: number): number | undefined =>
  typeof x === "number" && Number.isFinite(x) && x >= -limit && x <= limit ? x : undefined;

/** Comma-joined on the wire; sorted and deduped here so counting is order-free. */
function parseCategories(raw: unknown): MapCategory[] {
  if (typeof raw !== "string") return [];
  return [...new Set(raw.split(",").map((c) => c.trim()).filter(isMapCategory))].sort();
}

/**
 * The rows this page can act on.
 *
 * `null` means the document itself is not an index — no `rows` array — which is
 * the one failure worth retrying, because it is what a truncated or
 * intercepted response looks like.
 *
 * A *row* that fails, on the other hand, is dropped and the rest are kept. The
 * posture is `parseCategoryFeatures`': one bad row must not cost the other
 * 31,056 their citywide search, and every consumer of this index only ever
 * *discloses* what it holds — nothing is drawn, selected or navigated to from
 * here — so a missing row is a smaller disclosure and never a wrong one.
 *
 * A row is dropped when it has no id, no name, no category this build can
 * name, or a position outside the coordinate space. Ids are deduped as well:
 * the generator guarantees uniqueness (public/data/README.md, "Validation"),
 * and a duplicate that slipped through would be counted twice by exactly the
 * code this index exists to feed — a count is a promise about how many
 * features naming a category returns, and a doubled row makes it a lie.
 */
export function parseSearchIndex(json: unknown): SearchIndexEntry[] | null {
  if (!isRec(json) || !Array.isArray(json.rows)) return null;
  const entries: SearchIndexEntry[] = [];
  const seen = new Set<string>();
  for (const row of json.rows) {
    if (!Array.isArray(row) || row.length < ROW_COLUMNS) continue;
    const id = str(row[0]);
    const name = str(row[1]);
    if (!id || !name || seen.has(id)) continue;
    const categories = parseCategories(row[6]);
    if (categories.length === 0) continue;
    const lng = inRange(row[7], 180);
    const lat = inRange(row[8], 90);
    if (lng === undefined || lat === undefined) continue;
    const nameEn = str(row[2]);
    const brand = str(row[3]);
    const cuisine = str(row[4]);
    const address = str(row[5]);
    seen.add(id);
    entries.push({
      id,
      name,
      ...(nameEn ? { nameEn } : {}),
      ...(brand ? { brand } : {}),
      ...(cuisine ? { cuisine } : {}),
      ...(address ? { address } : {}),
      categories,
      lng,
      lat,
    });
  }
  return entries;
}

/**
 * What the loader needs from whichever store it is driving — the same shape as
 * `Tier2Backing`, and for the same reason: the Zustand store and the in-memory
 * test store share one implementation, so they cannot answer differently.
 */
export interface SearchIndexBacking {
  fetchJson: FetchJson;
  getStatus(): SearchIndexStatus;
  /**
   * Status and rows in one write, so nothing that subscribes to this store can
   * catch it saying "ready" over a null index, or "failed" over rows it holds.
   */
  set(status: SearchIndexStatus, entries: readonly SearchIndexEntry[] | null): void;
}

export interface SearchIndexLoader {
  /**
   * Fetches the index at most once per page. Concurrent callers share the one
   * request; a settled `ready` or `absent` costs nothing; a `failed` load is
   * attempted again. Never throws and never returns a reason: the whole point
   * of this file is that a consumer who cannot have it says less, rather than
   * failing.
   */
  load(): Promise<void>;
}

export function createSearchIndexLoader(backing: SearchIndexBacking): SearchIndexLoader {
  let inFlight: Promise<void> | null = null;

  async function load(): Promise<void> {
    const status = backing.getStatus();
    // Two settled answers, and neither is worth a second request: the rows are
    // already here, or this deployment has none and never will.
    if (status === "ready" || status === "absent") return;
    if (inFlight) return inFlight;
    // Written before the first await, so anything that renders in the window
    // between the first search and the file arriving can say "still loading"
    // rather than "there is no index".
    backing.set("loading", null);
    inFlight = (async () => {
      try {
        const entries = parseSearchIndex(await backing.fetchJson(SEARCH_INDEX_URL));
        // A document that is not an index is a served file that could not be
        // read — treated like the tier-2 loader treats one, as a moment rather
        // than a fact, because the deployment does offer the file.
        backing.set(entries ? "ready" : "failed", entries);
      } catch (e) {
        backing.set(isPermanentFetchError(e) ? "absent" : "failed", null);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return { load };
}
