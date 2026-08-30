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
   * Every category this feature belongs to, present only when there is more
   * than one. About a dozen POIs in Taipei are tagged twice (a bakery that is
   * also a fast-food counter), and they arrive in two files under one id. The
   * store keeps one feature — ids have to stay unique — so the second category
   * is recorded here instead, and a query for either one finds it.
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
  | { ok: false; category: Tier2Category; error: string };

/** JSON fetch used by the registry; rejects with a message a tool can print. */
export type FetchJson = (url: string) => Promise<unknown>;

/** The fetch a store gets when the app has no tier-2 files (or a test wants none). */
export const notFoundFetchJson: FetchJson = (url) =>
  Promise.reject(new Error(`${url}: 404 Not Found`));

/** Browser fetch, with the status folded into the message rather than thrown as a Response. */
export const httpFetchJson: FetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
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
    // `nameEn` is the contract, the same spelling the bundled datasets use.
    // `name_en` is accepted because the POI files are generated by a different
    // task and the two spellings were both in play while this was written; one
    // `??` is cheaper than a page that silently loses every English name.
    const nameEn = str(props.nameEn) ?? str(props.name_en);
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
 * What the registry needs from whichever store it is driving. Keeping this to
 * four methods is what lets the Zustand store and the in-memory test store
 * share one implementation — and therefore one behaviour.
 */
export interface Tier2Backing {
  fetchJson: FetchJson;
  getManifest(): Tier2Manifest | null;
  setManifest(manifest: Tier2Manifest): void;
  getLoadedCategories(): readonly Tier2Category[];
  /** Appends the features (minus ids already present) and marks the category loaded. */
  addLoadedCategory(category: Tier2Category, features: MapFeature[]): void;
}

export interface Tier2Registry {
  loadManifest(): Promise<Tier2ManifestResult>;
  loadCategory(category: Tier2Category): Promise<Tier2LoadResult>;
}

/**
 * The loader itself. Two calls for the same category share one fetch (an agent
 * naming `["cafe","cafe"]`, or two tools racing, must not download the file
 * twice), and a category already in memory resolves without touching the
 * network at all.
 */
export function createTier2Registry(backing: Tier2Backing): Tier2Registry {
  let manifestInFlight: Promise<Tier2ManifestResult> | null = null;
  const inFlight = new Map<Tier2Category, Promise<Tier2LoadResult>>();

  async function loadManifest(): Promise<Tier2ManifestResult> {
    const cached = backing.getManifest();
    if (cached) return { ok: true, manifest: cached };
    if (manifestInFlight) return manifestInFlight;
    manifestInFlight = (async () => {
      try {
        const json = await backing.fetchJson(TIER2_INDEX_URL);
        const parsed = parseManifest(json, TIER2_INDEX_URL);
        if (parsed.ok) backing.setManifest(parsed.manifest);
        return parsed;
      } catch (e) {
        // A failed manifest is not cached: the next call retries rather than
        // inheriting one bad network moment for the life of the page.
        return { ok: false as const, error: message(e) };
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
      };
    }
    const entry = manifest.manifest.categories.find((c) => c.category === category);
    if (!entry) {
      return {
        ok: false,
        category,
        error: `no data file for category "${category}": it is not listed in ${TIER2_INDEX_URL}`,
      };
    }
    const url = resolveTier2File(entry.file);
    try {
      const parsed = parseCategoryFeatures(await backing.fetchJson(url), category, url);
      if (!parsed.ok) return { ok: false, category, error: parsed.error };
      backing.addLoadedCategory(category, parsed.features);
      return { ok: true, category, fetched: true };
    } catch (e) {
      return { ok: false, category, error: `could not load "${category}": ${message(e)}` };
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

  return { loadManifest, loadCategory };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The categories a feature can be found under: its own, plus any it shares. */
export function featureCategories(feature: MapFeature): readonly MapCategory[] {
  return feature.properties.categories ?? [feature.properties.category];
}

/** The same feature, now also findable under `category`. */
function withCategory(feature: MapFeature, category: MapCategory): MapFeature {
  const categories = [...new Set([...featureCategories(feature), category])].sort();
  return { ...feature, properties: { ...feature.properties, categories } };
}

/**
 * The new tier-2 slice after a category arrives.
 *
 * Ids are unique across the whole store — the selection, the share link and
 * every tool argument key on them — so an id that arrives twice is merged, not
 * appended. Merging (rather than dropping) is what keeps the store a function
 * of *which* categories were asked for and not of the order: a POI tagged
 * bakery and fast_food answers both queries whichever file arrived first.
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
    byId.set(id, existing ? withCategory(existing, feature.properties.category) : feature);
  }
  return [...byId.values()];
}
