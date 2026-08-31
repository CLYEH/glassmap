#!/usr/bin/env node
/**
 * Derive public/data/tier2/search-index.json from the 18 tier-2 category
 * files already on disk (T-100 stage 1).
 *
 * Fixes the citywide-search defect: the map's search only covers whatever
 * tier-2 categories a session has *loaded*, so "starbucks" finds nothing on
 * a fresh page even though 152 Starbucks stores exist in cafe.geojson. This
 * index is a flat, always-available name lookup the search tool can load
 * once (independent of which categories are in memory) and match against.
 *
 * Local-only by design: this script never calls Overpass. Overpass's public
 * endpoints are increasingly unreliable for this pipeline (board ticket
 * F-5), and deriving the index from the committed tier-2 files instead of a
 * fresh export keeps it byte-reproducible from what is already on disk.
 *
 * Usage: node scripts/build-search-index.mjs
 * Also invoked automatically from scripts/fetch-tier2.mjs's write step
 * (both the full-run manifest write and --manifest-only), so a future
 * tier-2 re-export cannot forget to refresh the search index.
 *
 * Output: public/data/tier2/search-index.json
 *   { "generated": "<YYYY-MM-DD>", "rows": [[id, name, nameEn, brand, cuisine, address, categories, lng, lat], ...] }
 *
 * Row shape is a fixed contract (T-100) — the tool and UI stages code
 * against these exact tuple positions:
 *   - tuple positions never move.
 *   - "nameEn" / "brand" / "cuisine" / "address" are "" (never
 *     null/missing) when the source feature carries none. "address" is
 *     copied exactly as the source feature's enrichment field carries it
 *     (public/data/README.md, "Enrichment fields (T-97)") — no
 *     re-composition here.
 *   - "categories" is every tier-2 category file the id appears in,
 *     comma-joined in the order those files were read (CATEGORIES below) —
 *     a dual-tagged POI (e.g. a bakery that is also a fast-food counter,
 *     see public/data/README.md "Tier-2 categories") appears exactly once,
 *     with both categories, not as two rows.
 *   - lng/lat are 5-decimal numbers, rounded with the codebase's round5
 *     convention (src/lib/map-tools/state.ts) — tier-2 source files carry
 *     6dp, one decimal finer than this index needs.
 *   - rows are sorted by id.
 *   - tier-2 features only: the six always-loaded bundled datasets
 *     (mrt-stations, districts, parks, schools, supermarkets, listings)
 *     need no index because they are already in memory on every page.
 *
 * cuisine and address widen what a search can match beyond a place's own
 * name/brand: cuisine catches queries like "ramen" or "coffee" that name a
 * kind of place rather than a specific one, and address catches street- and
 * neighbourhood-name queries. No other enrichment field ships here — this
 * index is for *finding* a place by name/kind/address, not describing it;
 * `get_place_details` reads the full per-category files for everything else
 * (phone, website, wheelchair, opening_hours, category-specific fields).
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER2_DIR = join(__dirname, "..", "public", "data", "tier2");
const OUT_FILE = join(TIER2_DIR, "search-index.json");

const BBOX = { minLng: 121.45, minLat: 24.96, maxLng: 121.67, maxLat: 25.21 };

// The 18 canonical tier-2 categories (scripts/fetch-tier2.mjs), in the same
// alphabetical order public/data/tier2/index.json already lists them in.
// This order is what "file order" means for the "categories" tuple field: a
// dual-tagged id's categories list reflects the order its files were read
// in here, not a second, independent sort.
const CATEGORIES = [
  "bakery",
  "bank",
  "bar",
  "bicycle_rental",
  "cafe",
  "clinic",
  "convenience",
  "fast_food",
  "hospital",
  "hotel",
  "library",
  "museum",
  "parking",
  "pharmacy",
  "place_of_worship",
  "police",
  "post_office",
  "restaurant",
];

const round5 = (n) => Math.round(n * 1e5) / 1e5;

function readCategory(category) {
  const file = join(TIER2_DIR, `${category}.geojson`);
  const { features } = JSON.parse(readFileSync(file, "utf8"));
  return features;
}

/** Builds the row array (already sorted by id) from the 18 files on disk. */
export function buildRows() {
  const rowById = new Map();
  const categoriesById = new Map();
  // The source properties of the file each row's fields were taken from
  // (the first file its id was seen in) — kept only so validate() can check
  // cuisine/address were copied verbatim, not to feed the row itself.
  const sourcePropsById = new Map();

  for (const category of CATEGORIES) {
    for (const feature of readCategory(category)) {
      const props = feature.properties;
      const id = props.id;
      if (categoriesById.has(id)) {
        categoriesById.get(id).push(category);
        continue;
      }
      categoriesById.set(id, [category]);
      sourcePropsById.set(id, props);
      const [lng, lat] = feature.geometry.coordinates;
      rowById.set(id, [
        id,
        props.name ?? "",
        props.nameEn ?? "",
        props.brand ?? "",
        props.cuisine ?? "",
        props.address ?? "",
        "", // categories column, filled in below once every file has been read
        round5(lng),
        round5(lat),
      ]);
    }
  }

  for (const [id, categories] of categoriesById) {
    rowById.get(id)[6] = categories.join(",");
  }

  const sortedIds = [...rowById.keys()].sort((a, b) => a.localeCompare(b));
  return { rows: sortedIds.map((id) => rowById.get(id)), categoriesById, sourcePropsById };
}

/**
 * Every row's id unique (guaranteed by rowById keying, checked anyway),
 * every claimed category is a file the id was actually read from, names
 * non-empty, cuisine/address are "" or copied verbatim from the source
 * feature, coordinates in-bbox and exactly 5 decimal places.
 */
function validate(rows, categoriesById, sourcePropsById) {
  const problems = [];
  const seen = new Set();
  const isWithin5Decimals = (n) => Math.abs(n - Math.round(n * 1e5) / 1e5) < 1e-9;

  for (const [id, name, , , cuisine, address, categories, lng, lat] of rows) {
    if (seen.has(id)) problems.push(`${id}: duplicate id`);
    seen.add(id);

    if (!name) problems.push(`${id}: empty name`);

    const source = sourcePropsById.get(id) ?? {};
    if (cuisine !== (source.cuisine ?? "")) {
      problems.push(`${id}: cuisine "${cuisine}" does not match source "${source.cuisine ?? ""}"`);
    }
    if (address !== (source.address ?? "")) {
      problems.push(`${id}: address "${address}" does not match source "${source.address ?? ""}"`);
    }

    const claimed = categories.split(",");
    const actual = categoriesById.get(id) ?? [];
    if (claimed.length !== actual.length || claimed.some((c, i) => c !== actual[i])) {
      problems.push(`${id}: categories "${categories}" do not match the files it was read from (${actual.join(",")})`);
    }

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      problems.push(`${id}: non-finite coordinate`);
    } else {
      if (lng < BBOX.minLng || lng > BBOX.maxLng || lat < BBOX.minLat || lat > BBOX.maxLat) {
        problems.push(`${id}: out of bbox (${lng},${lat})`);
      }
      if (!isWithin5Decimals(lng) || !isWithin5Decimals(lat)) {
        problems.push(`${id}: coordinate not 5dp (${lng},${lat})`);
      }
    }
  }
  return problems;
}

/** Above this, the index is flagged loudly rather than silently shipped —
 *  see public/data/README.md for the tradeoff (address/cuisine coverage vs
 *  size) that produced this number. Not a hard cap: nothing here trims rows
 *  to stay under it. */
const GZIP_WARN_BYTES = 1.2 * 1024 * 1024;

/** Builds, validates, writes search-index.json, and logs a short report. */
export function writeSearchIndex() {
  const { rows, categoriesById, sourcePropsById } = buildRows();
  const problems = validate(rows, categoriesById, sourcePropsById);

  const generated = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify({ generated, rows });
  writeFileSync(OUT_FILE, json);

  const bytes = statSync(OUT_FILE).size;
  const gzipBytes = gzipSync(readFileSync(OUT_FILE), { level: 9 }).length;
  const dualTagged = [...categoriesById.values()].filter((c) => c.length > 1).length;

  console.log(
    `search-index.json: ${rows.length} rows, ${(bytes / 1024).toFixed(1)} KB raw / ` +
      `${(gzipBytes / 1024).toFixed(1)} KB gzip -9, ${dualTagged} dual-tagged ids deduped.`,
  );
  if (gzipBytes > GZIP_WARN_BYTES) {
    console.log(
      `WARNING: gzip -9 size ${(gzipBytes / 1024 / 1024).toFixed(2)} MB exceeds the ` +
        `${(GZIP_WARN_BYTES / 1024 / 1024).toFixed(1)} MB flag threshold (public/data/README.md).`,
    );
  }
  if (problems.length) {
    console.log(`${problems.length} validation PROBLEMS:`);
    for (const p of problems.slice(0, 20)) console.log(`  PROBLEM: ${p}`);
    if (problems.length > 20) console.log(`  ...and ${problems.length - 20} more`);
    process.exitCode = 1;
  } else {
    console.log("Validation OK: ids unique, categories match source files, names non-empty, coords in-bbox and 5dp.");
  }
  return { rows, problems };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  writeSearchIndex();
}
