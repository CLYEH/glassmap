/**
 * Tier-2 categories: the point-of-interest layers that are fetched *whole city*
 * the first time an agent names one, and never before.
 *
 * Three rules make this predictable enough for an agent to reason about:
 *
 *  - **Category-lazy, never bbox-lazy.** A category is loaded for the whole
 *    city or not at all, so what is in memory is a function of the categories
 *    that were asked for and nothing else. If loading followed the camera, the
 *    same question would get different answers depending on where the human had
 *    panned — invisible to an agent that cannot see the screen.
 *  - **Category filtering is the query model.** There is no "load everything":
 *    the 18 files together are far larger than the six always-loaded datasets,
 *    and an agent that cannot name a category does not know what it is looking
 *    for. A query with no category searches what is loaded and says so.
 *  - **Loud failure.** A file that will not load comes back as an error the
 *    tool returns verbatim. The one thing we never do is answer "no cafes
 *    nearby" when the truth is "the cafe file did not arrive".
 *
 * Nothing here is evicted: a category stays until the page is unloaded. Eviction
 * would make the store's contents depend on call *history* as well as on the
 * requested set, which is the determinism this module exists to protect.
 */
import type { Feature, Geometry } from "geojson";
import {
  isFeatureCategory,
  type FeatureCategory,
  type GlassMapFeatureProperties,
} from "@/lib/data/schema";

/**
 * The fixed vocabulary. Fixed because it is baked into every tool's input
 * schema: an agent picks a category out of the enum, so a category that is not
 * here cannot be asked for even if a file exists for it.
 */
export const TIER2_CATEGORIES = [
  "restaurant",
  "cafe",
  "fast_food",
  "bakery",
  "bar",
  "convenience",
  "pharmacy",
  "clinic",
  "hospital",
  "place_of_worship",
  "bank",
  "hotel",
  "parking",
  "bicycle_rental",
  "library",
  "museum",
  "post_office",
  "police",
] as const;

export type Tier2Category = (typeof TIER2_CATEGORIES)[number];

export function isTier2Category(x: unknown): x is Tier2Category {
  return typeof x === "string" && (TIER2_CATEGORIES as readonly string[]).includes(x);
}

/** Every category a loaded feature can carry: the six datasets plus the 18 POI files. */
export type MapCategory = FeatureCategory | Tier2Category;

export function isMapCategory(x: unknown): x is MapCategory {
  return isFeatureCategory(x) || isTier2Category(x);
}

/**
 * A feature as the tool layer sees it. Same shape as `GlassMapFeature` with a
 * wider category, plus the three tags a POI answer is actually made of. The
 * widening is deliberate: `GlassMapFeature` stays the type of the six bundled
 * datasets, so UI code that maps a category to a colour or a legend label keeps
 * its exhaustive check and finds out at compile time when it has to handle POIs.
 */
export interface MapFeatureProperties extends Omit<GlassMapFeatureProperties, "category"> {
  category: MapCategory;
  /**
   * Every category this feature belongs to, sorted, present only when there is
   * more than one. 12 ids in the shipped extract appear in two category files
   * (a bakery that is also a fast-food counter — public/data/README.md,
   * "Tier-2 categories"), because each file is generated from its own tag
   * query. The store keeps one feature — ids have to stay unique — so the other
   * categories are recorded here instead, and a query for any of them finds it.
   * `category` is always `categories[0]`; see `mergeTier2`.
   */
  categories?: MapCategory[];
  /** Tier-2 only: OSM `cuisine`, e.g. "vegetarian;taiwanese". */
  cuisine?: string;
  /** Tier-2 only: OSM `brand`. */
  brand?: string;
  /** Tier-2 only: OSM `opening_hours`, verbatim. */
  opening_hours?: string;
}

export type MapFeature = Feature<Geometry, MapFeatureProperties>;

/** Where the manifest lives. One fetch per page, and only if a tool needs it. */
export const TIER2_INDEX_URL = "/data/tier2/index.json";

/** Manifest `file` entries are resolved against this when they are not absolute. */
export const TIER2_DIR = "/data/tier2/";

/**
 * One line of the manifest. `count` is what makes honest disclosure cheap: a
 * tool can say "1841 cafes exist and I did not search them" without fetching a
 * single feature.
 */
export interface Tier2ManifestEntry {
  category: Tier2Category;
  count: number;
  file: string;
  bytes?: number;
}

export interface Tier2Manifest {
  generated?: string;
  attribution?: string;
  categories: Tier2ManifestEntry[];
}

export type Tier2ManifestResult =
  | { ok: true; manifest: Tier2Manifest }
  | { ok: false; error: string };

export type Tier2LoadResult =
  /** `fetched` is false when the category was already in memory. */
  | { ok: true; category: Tier2Category; fetched: boolean }
  | { ok: false; category: Tier2Category; error: string; permanent: boolean };

/** One category a share link declared that this page could not load. */
export interface Tier2RestoreFailure {
  category: Tier2Category;
  /** The loader's own sentence, for the agent to repeat and the page to show. */
  error: string;
  /**
   * True when this deployment does not offer the file at all — a 4xx, or a
   * category the index it did serve does not list. False for a moment: a 5xx, a
   * dropped connection, a timeout, a file that arrived unreadable. The
   * difference is not cosmetic; it decides whether a link this page hands on
   * still declares the category (see `shareCategories`).
   */
  permanent: boolean;
}

/**
 * What restoring the categories of a share link ended up doing. `ok` is false
 * as soon as one category failed: a link is a promise to reproduce the sender's
 * map, and a map missing one of its categories is not that map.
 */
export interface Tier2RestoreResult {
  ok: boolean;
  /** Every declared category now in memory, sorted — including ones already loaded. */
  loaded: Tier2Category[];
  failed: Tier2RestoreFailure[];
}

/** JSON fetch used by the registry; rejects with a message a tool can print. */
export type FetchJson = (url: string) => Promise<unknown>;

/**
 * A failed request that knows *why* it failed. The registry has to tell "this
 * page ships no tier-2 files" (404 — permanent, stop asking) from "the network
 * had a bad moment" (5xx, offline — ask again next time), and a bare Error
 * message can only be pattern-matched, which would break the day a mirror
 * words its status line differently.
 */
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

/**
 * The 4xx statuses that mean "ask again later", not "stop asking": 408 Request
 * Timeout (RFC 9110 §15.5.9 — the client MAY repeat the request), 425 Too Early
 * (RFC 8470 §5.2 — retry once the request is no longer early data) and 429 Too
 * Many Requests (RFC 6585 §4 — retry after backing off).
 */
const RETRYABLE_4XX = new Set([408, 425, 429]);

/**
 * True when asking again could not possibly help. That is most of 4xx — a 404
 * means this deployment ships no such file, and re-requesting it once per
 * question for the life of the tab buys the human nothing but latency.
 *
 * It is not *all* of 4xx, and the difference is not academic: a CDN answering
 * 429 to the 2.5 MB restaurant file is rate limiting, not deleting. Counting
 * that as permanent would drop the category from every share link this page
 * goes on to hand out — one busy second turning into a smaller map for every
 * reader downstream. 5xx and a dropped connection are moments, never facts.
 */
export function isPermanentFetchError(e: unknown): boolean {
  return (
    e instanceof HttpStatusError &&
    e.status >= 400 &&
    e.status < 500 &&
    !RETRYABLE_4XX.has(e.status)
  );
}

/** The fetch a store gets when the app has no tier-2 files (or a test wants none). */
export const notFoundFetchJson: FetchJson = (url) =>
  Promise.reject(new HttpStatusError(404, `${url}: 404 Not Found`));

/**
 * How long a tier-2 request may take before it is called a failure. Generous
 * enough for the largest file (restaurant, 2.5 MB) on a slow connection, finite
 * because the alternative is worse than any timeout.
 */
export const TIER2_FETCH_TIMEOUT_MS = 30_000;

/** Browser fetch, with the status folded into the message rather than thrown as a Response. */
export const httpFetchJson: FetchJson = async (url) => {
  let res: Response;
  try {
    // A fetch with no timeout can stall for as long as the tab is open, and a
    // tool call that never returns is the one failure an agent can neither
    // report nor retry: it just looks like the agent stopped answering.
    res = await fetch(url, { signal: AbortSignal.timeout(TIER2_FETCH_TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    throw new Error(
      `${url}: ${timedOut ? `no response after ${TIER2_FETCH_TIMEOUT_MS / 1000}s` : message(e)}`,
    );
  }
  if (!res.ok) throw new HttpStatusError(res.status, `${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as unknown;
};

const isRec = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const str = (x: unknown): string | undefined =>
  typeof x === "string" && x.trim() ? x : undefined;

/** `restaurant.geojson` and `/data/tier2/restaurant.geojson` both work. */
export function resolveTier2File(file: string): string {
  return file.startsWith("/") || /^https?:/i.test(file) ? file : `${TIER2_DIR}${file}`;
}

/**
 * Manifest entries we can act on. An entry for a category outside the fixed
 * vocabulary is dropped rather than rejected: no tool schema can name it, so a
 * data file that runs ahead of the code must not take the other 18 down with it.
 */
export function parseManifest(json: unknown, url: string): Tier2ManifestResult {
  if (!isRec(json) || !Array.isArray(json.categories)) {
    return { ok: false, error: `${url}: not a tier-2 manifest (no "categories" array)` };
  }
  const categories: Tier2ManifestEntry[] = [];
  for (const raw of json.categories) {
    if (!isRec(raw) || !isTier2Category(raw.category)) continue;
    const file = str(raw.file);
    const count = raw.count;
    if (!file || typeof count !== "number" || !Number.isFinite(count) || count < 0) {
      return {
        ok: false,
        error: `${url}: entry "${raw.category}" needs a file and a count`,
      };
    }
    categories.push({
      category: raw.category,
      count,
      file,
      ...(typeof raw.bytes === "number" && Number.isFinite(raw.bytes) ? { bytes: raw.bytes } : {}),
    });
  }
  return {
    ok: true,
    manifest: {
      ...(str(json.generated) ? { generated: json.generated as string } : {}),
      ...(str(json.attribution) ? { attribution: json.attribution as string } : {}),
      categories,
    },
  };
}

/**
 * Features of one category file, normalised to the shape the rest of the app
 * reads: one `nameEn` spelling and a `source`, so no tool needs a second code
 * path for POIs. A feature carrying the wrong category is a hard error rather
 * than a silent skip — it would leave the store saying "cafe is loaded" while
 * the cafe query answers nothing, which is the one lie this layer must not
 * tell. A POI with no name is kept: a nameless car park is still where you can
 * park, it simply cannot be looked up by name.
 */
export function parseCategoryFeatures(
  json: unknown,
  category: Tier2Category,
  url: string,
): { ok: true; features: MapFeature[] } | { ok: false; error: string } {
  if (!isRec(json) || !Array.isArray(json.features)) {
    return { ok: false, error: `${url}: not a FeatureCollection (no "features" array)` };
  }
  const features: MapFeature[] = [];
  for (const raw of json.features) {
    if (!isRec(raw)) continue;
    const props = isRec(raw.properties) ? raw.properties : undefined;
    const id = str(props?.id);
    if (!id || !raw.geometry) continue;
    if (props?.category !== category) {
      return {
        ok: false,
        error: `${url}: feature ${id} has category "${String(props?.category)}", expected "${category}"`,
      };
    }
    // `nameEn` is the contract: the POI files use the same spelling as the
    // bundled datasets (public/data/README.md, "Tier-2 categories"). Accepting a
    // second spelling as well would hide the day the generator stops honouring
    // it — English names would just quietly disappear from every answer.
    const nameEn = str(props.nameEn);
    features.push({
      type: "Feature",
      geometry: raw.geometry as Geometry,
      properties: {
        id,
        name: str(props.name) ?? "",
        ...(nameEn ? { nameEn } : {}),
        category,
        source: "osm",
        ...(str(props.cuisine) ? { cuisine: props.cuisine as string } : {}),
        ...(str(props.brand) ? { brand: props.brand as string } : {}),
        ...(str(props.opening_hours) ? { opening_hours: props.opening_hours as string } : {}),
      },
    });
  }
  return { ok: true, features };
}

/** Sorted and deduped, so `loaded` never depends on the order categories arrived in. */
export function sortedCategories(categories: readonly Tier2Category[]): Tier2Category[] {
  return [...new Set(categories)].sort();
}

/**
 * What a share link should declare: every category in memory *plus* every
 * category an incoming link is still loading.
 *
 * The pending half is the whole point. A recipient's address bar is rewritten a
 * few hundred milliseconds after the link is applied — long before a 500 KB
 * category file has arrived — and a mirror that wrote only what had finished
 * loading would hand the recipient a link to a map without the categories the
 * sender shared, and without the selection that depends on them. One function
 * so the tool that hands out a link and the mirror that rewrites the bar cannot
 * disagree about what the map is.
 *
 * The third argument is the same argument one step later. A failure that was a
 * moment — a 5xx, a dropped connection — must not permanently downgrade every
 * link downstream of it: the recipient whose cafe file caught a bad second
 * would otherwise hand on a link whose cafe ids are declared by no category,
 * and the third reader gets a selection nothing will ever resolve. So a
 * non-permanent failure keeps its category declared: the next page to open the
 * link asks for the file again, which is exactly what "transient" means.
 * Permanent failures (4xx, or a category this build's index does not list) are
 * dropped, because there is no page for which that file exists, and a link
 * declaring it would only make the next reader wait for the same 404.
 *
 * Callers pass all three lists rather than a store, so the tool that hands out
 * a link and the mirror that rewrites the address bar cannot pick different
 * halves of the same state.
 */
export function shareCategories(
  loaded: readonly Tier2Category[],
  pending: readonly Tier2Category[],
  failures: readonly Tier2RestoreFailure[],
): Tier2Category[] {
  return sortedCategories([
    ...loaded,
    ...pending,
    ...failures.filter((f) => !f.permanent).map((f) => f.category),
  ]);
}

/**
 * What the registry needs from whichever store it is driving. Keeping this to
 * one small interface is what lets the Zustand store and the in-memory test
 * store share one implementation — and therefore one behaviour.
 */
export interface Tier2Backing {
  fetchJson: FetchJson;
  getManifest(): Tier2Manifest | null;
  setManifest(manifest: Tier2Manifest): void;
  getLoadedCategories(): readonly Tier2Category[];
  /**
   * Appends the features (minus ids already present), marks the category
   * loaded, and clears any restore failure recorded against it. The last part
   * is not bookkeeping: a category whose features are in memory cannot at the
   * same time be one this page "could not load", and a notice that says
   * otherwise is a lie told over a map that visibly contradicts it. One write,
   * so no subscriber can observe the two halves disagreeing.
   */
  addLoadedCategory(category: Tier2Category, features: MapFeature[]): void;
  /**
   * Categories declared by a share link that have not settled yet. Read as well
   * as written because a restore adds to this list rather than owning it; see
   * `restoreCategories`.
   */
  getPendingCategories(): readonly Tier2Category[];
  setPendingCategories(categories: Tier2Category[]): void;
  /** Everything a restore has failed to load so far, likewise added to, not owned. */
  getRestoreFailures(): readonly Tier2RestoreFailure[];
  setRestoreFailures(failures: Tier2RestoreFailure[]): void;
}

export interface Tier2Registry {
  loadManifest(): Promise<Tier2ManifestResult>;
  loadCategory(category: Tier2Category): Promise<Tier2LoadResult>;
  /**
   * Load every category a share link declared. See `restoreCategories` below
   * for the two timing rules the rest of the app depends on.
   */
  restoreCategories(categories: readonly Tier2Category[]): Promise<Tier2RestoreResult>;
}

/**
 * The loader itself. Two calls for the same category share one fetch (an agent
 * naming `["cafe","cafe"]`, or two tools racing, must not download the file
 * twice), and a category already in memory resolves without touching the
 * network at all.
 */
export function createTier2Registry(backing: Tier2Backing): Tier2Registry {
  let manifestInFlight: Promise<Tier2ManifestResult> | null = null;
  /** Set only by a 4xx: the answer to "is there tier-2 data here?" is "no". */
  let manifestAbsent: Tier2ManifestResult | null = null;
  const inFlight = new Map<Tier2Category, Promise<Tier2LoadResult>>();

  async function loadManifest(): Promise<Tier2ManifestResult> {
    const cached = backing.getManifest();
    if (cached) return { ok: true, manifest: cached };
    if (manifestAbsent) return manifestAbsent;
    if (manifestInFlight) return manifestInFlight;
    manifestInFlight = (async () => {
      try {
        const json = await backing.fetchJson(TIER2_INDEX_URL);
        const parsed = parseManifest(json, TIER2_INDEX_URL);
        if (parsed.ok) backing.setManifest(parsed.manifest);
        return parsed;
      } catch (e) {
        const result = { ok: false as const, error: message(e) };
        // Two different failures, two different memories. A 404 means this
        // deployment ships no tier-2 files, which cannot change while the tab is
        // open: every bare query would otherwise re-request the same missing
        // file, once per question, for the life of the session. A 5xx or a
        // dropped connection is a moment, not a fact, so it is retried — one bad
        // request must not turn every later POI question into "no data".
        if (isPermanentFetchError(e)) manifestAbsent = result;
        return result;
      } finally {
        manifestInFlight = null;
      }
    })();
    return manifestInFlight;
  }

  async function fetchCategory(category: Tier2Category): Promise<Tier2LoadResult> {
    const manifest = await loadManifest();
    if (!manifest.ok) {
      // Every failure names the category. An agent that asked for cafes and is
      // told "the index failed" cannot tell which of its three categories it is
      // missing, and the honest answer is the one it has to relay to a human.
      return {
        ok: false,
        category,
        error: `could not load "${category}": the category index did not load (${manifest.error})`,
        // `manifestAbsent` is set by a 4xx and nothing else, so it is the same
        // question one level up: is there tier-2 data on this deployment at all?
        permanent: manifestAbsent !== null,
      };
    }
    const entry = manifest.manifest.categories.find((c) => c.category === category);
    if (!entry) {
      return {
        ok: false,
        category,
        error: `no data file for category "${category}": it is not listed in ${TIER2_INDEX_URL}`,
        // An index this page did read, that does not name the category: as
        // final an answer as a 404, and it will not change while the tab lives.
        permanent: true,
      };
    }
    const url = resolveTier2File(entry.file);
    try {
      const parsed = parseCategoryFeatures(await backing.fetchJson(url), category, url);
      // The file was served and could not be read. Not permanent: the deployment
      // does offer this category, and calling it absent would quietly delete it
      // from every link that passes through this page.
      if (!parsed.ok) return { ok: false, category, error: parsed.error, permanent: false };
      backing.addLoadedCategory(category, parsed.features);
      return { ok: true, category, fetched: true };
    } catch (e) {
      return {
        ok: false,
        category,
        error: `could not load "${category}": ${message(e)}`,
        permanent: isPermanentFetchError(e),
      };
    }
  }

  async function loadCategory(category: Tier2Category): Promise<Tier2LoadResult> {
    if (backing.getLoadedCategories().includes(category)) {
      return { ok: true, category, fetched: false };
    }
    const running = inFlight.get(category);
    if (running) return running;
    const started = fetchCategory(category).finally(() => inFlight.delete(category));
    inFlight.set(category, started);
    return started;
  }

  /**
   * The categories of an incoming share link, loaded before the map is asked
   * about the features they contain.
   *
   * Two timing rules, and both are load-bearing:
   *
   *  - **Pending is set synchronously**, before the first await, so anything
   *    that runs between opening a link and the first file arriving already
   *    knows those categories are coming. That window is where the damage used
   *    to happen: the selection a link carries names features nobody has
   *    fetched yet, and both the address-bar mirror and `select_features` would
   *    otherwise treat those ids as dead and drop them — the recipient's URL
   *    losing the sender's selection while the sender watches.
   *  - **A failure is recorded before its category leaves pending**, so there
   *    is no instant in which a category is neither still coming nor known to
   *    have failed. Pruning is allowed exactly in the second state, and a tool
   *    call landing in a gap between the two would delete the ids the link is
   *    about while the page could still have said why. The test that holds this
   *    line asserts over a trace of every write, not over the state afterwards:
   *    a gap only exists between two assignments, so a test that looks once the
   *    call has settled cannot see it.
   *  - **Pending is added to, never replaced**, and only the categories this
   *    call asked for get their earlier failure cleared. A second restore that
   *    starts while the first one's files are in flight would otherwise
   *    un-declare them, and every id waiting on those files is pruned as dead
   *    by the next tool call — the exact damage the first rule exists to
   *    prevent, re-introduced by the caller. One caller applies one link per
   *    page load today, so this costs a filter and buys not having to keep that
   *    true forever.
   *
   * Sequential and sorted, like `planCategories`: the store then holds the same
   * features in the same order as the map that produced the link, which is what
   * "the link reproduces the sender's map" has to mean for a query whose
   * results tie.
   */
  async function restoreCategories(
    requested: readonly Tier2Category[],
  ): Promise<Tier2RestoreResult> {
    const wanted = sortedCategories(requested.filter(isTier2Category));
    const alreadyLoaded = backing.getLoadedCategories();
    const loaded = wanted.filter((c) => alreadyLoaded.includes(c));
    const pending = wanted.filter((c) => !alreadyLoaded.includes(c));
    backing.setPendingCategories(
      sortedCategories([...backing.getPendingCategories(), ...pending]),
    );
    // A retry clears its own category's failure, and nobody else's: another
    // restore's 404 is still the reason its ids were pruned.
    backing.setRestoreFailures(
      backing.getRestoreFailures().filter((f) => !wanted.includes(f.category)),
    );
    if (!pending.length) return { ok: true, loaded, failed: [] };

    const failed: Tier2RestoreFailure[] = [];
    for (const category of pending) {
      const result = await loadCategory(category);
      if (result.ok) loaded.push(category);
      else {
        const failure = { category, error: result.error, permanent: result.permanent };
        failed.push(failure);
        backing.setRestoreFailures([
          ...backing.getRestoreFailures().filter((f) => f.category !== category),
          failure,
        ]);
      }
      backing.setPendingCategories(backing.getPendingCategories().filter((c) => c !== category));
    }
    return { ok: failed.length === 0, loaded: sortedCategories(loaded), failed };
  }

  return { loadManifest, loadCategory, restoreCategories };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The categories a feature can be found under: its own, plus any it shares. */
export function featureCategories(feature: MapFeature): readonly MapCategory[] {
  return feature.properties.categories ?? [feature.properties.category];
}

/**
 * One feature out of the same id seen in two category files.
 *
 * Everything about the result is decided by the categories alone, never by
 * which file arrived first: the union is sorted, `category` is its head, and
 * every *other* field — name, nameEn, cuisine, brand, opening_hours, geometry —
 * comes from the file of that same head category. Picking a single winning file
 * rather than merging field by field is what keeps the answer self-consistent:
 * the name an agent reads out and the category it reads out describe the same
 * row of the same file.
 *
 * The rule has to hold even though the 12 dual-tagged rows in the current
 * extract are identical apart from `category` (verified against
 * public/data/tier2/**), because the generator supports regenerating one
 * category at a time (`fetch-tier2.mjs --only=…`): two files can be exported
 * weeks apart, and an OSM rename between the two runs lands in one of them
 * only. Order-dependence would then show up as the same question getting two
 * different answers depending on which category the human happened to ask
 * about first — invisible to an agent that cannot see the screen.
 *
 * `winner.properties.category` is the smallest category of its own set (this
 * function maintains that, and a freshly parsed feature has a set of one), so
 * comparing the two heads is enough to find the smallest of the union.
 */
function mergeTier2(existing: MapFeature, incoming: MapFeature): MapFeature {
  const categories = [
    ...new Set([...featureCategories(existing), ...featureCategories(incoming)]),
  ].sort();
  const winner =
    incoming.properties.category < existing.properties.category ? incoming : existing;
  return {
    ...winner,
    properties: { ...winner.properties, category: categories[0], categories },
  };
}

/**
 * The new tier-2 slice after a category arrives.
 *
 * Ids are unique across the whole store — the selection, the share link and
 * every tool argument key on them — so an id that arrives twice is merged, not
 * appended. Merging (rather than dropping) is what keeps the store a function
 * of *which* categories were asked for and not of the order: a POI tagged
 * bakery and fast_food answers both queries whichever file arrived first, and
 * `mergeTier2` makes the merged feature itself identical either way.
 *
 * A bundled dataset always wins: those six categories are the map's own
 * rendering, and this module does not get to rewrite them.
 */
export function appendTier2Features(
  bundled: readonly { properties: { id: string } }[],
  tier2: readonly MapFeature[],
  incoming: readonly MapFeature[],
): MapFeature[] {
  const bundledIds = new Set<string>();
  for (const f of bundled) bundledIds.add(f.properties.id);
  const byId = new Map<string, MapFeature>();
  for (const f of tier2) byId.set(f.properties.id, f);

  for (const feature of incoming) {
    const id = feature.properties.id;
    if (bundledIds.has(id)) continue;
    const existing = byId.get(id);
    // Map.set on a known key keeps its position, so the store's order stays
    // "bundled, then categories in the order they loaded".
    byId.set(id, existing ? mergeTier2(existing, feature) : feature);
  }
  return [...byId.values()];
}
