#!/usr/bin/env node
/**
 * Fetch Tier-2 OSM point-of-interest categories for GlassMap via the
 * Overpass API.
 *
 * Preparation-time only: run manually by the data engineer to regenerate
 * public/data/tier2/*.geojson. The running app never calls Overpass.
 *
 * Companion to scripts/fetch-osm.mjs (tier-1: mrt/districts/parks/schools/
 * supermarkets). Kept as a separate file rather than extending fetch-osm.mjs
 * so a tier-2 re-run can never perturb the tier-1 outputs; the bbox and
 * retry/backoff shape below are the same as fetch-osm.mjs's `overpassQuery`
 * (a request timeout and a third mirror were added here - see the comment
 * on ENDPOINTS for why).
 *
 * Usage: node scripts/fetch-tier2.mjs [--only=cafe,bank,...] [--manifest-only]
 *   --only=<comma-separated categories>  fetch only those categories
 *   --manifest-only                      skip Overpass entirely, rebuild
 *                                         index.json from files already on
 *                                         disk (all 18 must already exist)
 *
 * Produces (in public/data/tier2/):
 *   <category>.geojson - one file per canonical category (point features,
 *                         centroid for ways/relations via `out center`)
 *   index.json          - manifest: { generated, attribution, categories }
 *                         so the tool layer can read per-category counts
 *                         without loading every file.
 *
 * Categories (fixed, 18 total - do not rename, the tool layer is coded
 * against these exact strings):
 *   restaurant, cafe, fast_food, bakery, bar, convenience, pharmacy,
 *   clinic, hospital, place_of_worship, bank, hotel, parking,
 *   bicycle_rental, library, museum, post_office, police
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "data", "tier2");
mkdirSync(OUT_DIR, { recursive: true });

// Same Taipei City bounding box as fetch-osm.mjs. Overpass order: south,west,north,east.
const BBOX = "24.96,121.45,25.21,121.67";
const BBOX_NUM = { minLng: 121.45, minLat: 24.96, maxLng: 121.67, maxLat: 25.21 };

// A third mirror beyond fetch-osm.mjs's two: during this export the primary
// (overpass-api.de) started refusing connections outright (its own fair-use
// throttle, tripped by tier-2's much heavier request volume - the restaurant
// query alone returned 13.8k elements / 2.6 MB) and the kumi.systems mirror
// was independently returning HTTP 500 for unrelated requests too. Verified
// with `curl` outside this script that openstreetmap.fr returns real, current
// global data for this bbox before adding it (an earlier candidate,
// overpass.osm.ch, returned HTTP 200 with zero elements for every query -
// silently wrong rather than failing loud - and was rejected for that reason).
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

// canonical category -> single Overpass tag match. Every category maps to
// exactly one key=value pair per the task's tag mapping.
const CATEGORY_TAGS = [
  ["restaurant", "amenity", "restaurant"],
  ["cafe", "amenity", "cafe"],
  ["fast_food", "amenity", "fast_food"],
  ["bakery", "shop", "bakery"],
  ["bar", "amenity", "bar"],
  ["convenience", "shop", "convenience"],
  ["pharmacy", "amenity", "pharmacy"],
  ["clinic", "amenity", "clinic"],
  ["hospital", "amenity", "hospital"],
  ["place_of_worship", "amenity", "place_of_worship"],
  ["bank", "amenity", "bank"],
  ["hotel", "tourism", "hotel"],
  ["parking", "amenity", "parking"],
  ["bicycle_rental", "amenity", "bicycle_rental"],
  ["library", "amenity", "library"],
  ["museum", "tourism", "museum"],
  ["post_office", "amenity", "post_office"],
  ["police", "amenity", "police"],
];

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function inBbox(lng, lat) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= BBOX_NUM.minLng &&
    lng <= BBOX_NUM.maxLng &&
    lat >= BBOX_NUM.minLat &&
    lat <= BBOX_NUM.maxLat
  );
}

/** POST an Overpass QL query, retrying on 429/504 with backoff and falling
 *  back to the next mirror in ENDPOINTS. Same retry/backoff shape as
 *  fetch-osm.mjs's overpassQuery, plus a per-request timeout (see below). */
async function overpassQuery(ql) {
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          // Overpass's front-end Apache returns 406 for Node's default UA/Accept.
          headers: { "User-Agent": "glassmap-data-fetch/1.0 (build-time script)", Accept: "*/*" },
          body: ql,
          // Large tier-2 categories can otherwise hang indefinitely on a stalled
          // connection with no error and no retry (observed in practice on this
          // pipeline: a request that neither resolved nor rejected for minutes).
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 429 || res.status === 504) {
          const wait = 2 ** attempt * 1000;
          console.warn(`  ${endpoint} -> HTTP ${res.status}, retrying in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) {
          throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        return await res.json();
      } catch (err) {
        lastErr = err;
        console.warn(`  ${endpoint} attempt ${attempt + 1} failed: ${err.message}`);
        await sleep(1000 * (attempt + 1));
      }
    }
  }
  throw lastErr ?? new Error("Overpass query failed on all endpoints");
}

/**
 * Fetch one canonical category: nwr[key=value](bbox); out center; Points
 * only (tier-2 has no polygon consumers) - nodes give their own coordinate,
 * ways/relations give Overpass's `out center` centroid.
 *
 * Unnamed features are skipped entirely per the tier-2 contract. Optional
 * enrichment tags (cuisine, brand, opening_hours) are carried when present;
 * opening_hours is truncated to 120 chars (free-text tag, occasionally very
 * long in OSM). No other tags are kept.
 */
async function fetchCategory(category, key, value) {
  const ql = `[out:json][timeout:180];
nwr["${key}"="${value}"](${BBOX});
out center;`;
  const data = await overpassQuery(ql);

  const features = [];
  for (const el of data.elements) {
    let lng;
    let lat;
    if (el.type === "node") {
      lng = el.lon;
      lat = el.lat;
    } else if (el.center) {
      lng = el.center.lon;
      lat = el.center.lat;
    } else {
      continue;
    }
    lng = round6(lng);
    lat = round6(lat);
    if (!inBbox(lng, lat)) continue;

    const tags = el.tags ?? {};
    const name = tags.name;
    if (!name) continue; // skip unnamed features entirely

    const properties = {
      id: `osm:${el.type}:${el.id}`,
      name,
      category,
    };
    if (typeof tags["name:en"] === "string") properties.name_en = tags["name:en"];
    if (typeof tags.cuisine === "string") properties.cuisine = tags.cuisine;
    if (typeof tags.brand === "string") properties.brand = tags.brand;
    if (typeof tags.opening_hours === "string") {
      properties.opening_hours = tags.opening_hours.slice(0, 120);
    }

    features.push({
      type: "Feature",
      properties,
      geometry: { type: "Point", coordinates: [lng, lat] },
    });
  }
  return features;
}

function writeCollection(category, features) {
  const sorted = [...features].sort((a, b) => a.properties.id.localeCompare(b.properties.id));
  const json = JSON.stringify({ type: "FeatureCollection", features: sorted });
  const filename = `${category}.geojson`;
  writeFileSync(join(OUT_DIR, filename), json);
  return { filename, count: sorted.length, bytes: Buffer.byteLength(json) };
}

function validate(category, features) {
  const ids = new Set();
  const problems = [];
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) problems.push(`${f.properties.id}: NaN coordinate`);
    else if (!inBbox(lng, lat)) problems.push(`${f.properties.id}: out of bbox (${lng},${lat})`);
    if (ids.has(f.properties.id)) problems.push(`${f.properties.id}: duplicate id within ${category}.geojson`);
    ids.add(f.properties.id);
  }
  return problems;
}

/** Rebuild index.json from files already on disk, without querying Overpass
 *  at all - used after one or more --only runs have written every category
 *  file, so the manifest does not force a redundant re-fetch of large
 *  categories (e.g. restaurant, ~2.6 MB) that already succeeded. */
function writeManifestOnly() {
  const manifestEntries = [];
  for (const [category] of CATEGORY_TAGS) {
    const filename = `${category}.geojson`;
    const path = join(OUT_DIR, filename);
    if (!existsSync(path)) {
      throw new Error(`--manifest-only: ${filename} is missing, run a full fetch first`);
    }
    const bytes = statSync(path).size;
    const { features } = JSON.parse(readFileSync(path, "utf8"));
    manifestEntries.push({ category, count: features.length, file: `/data/tier2/${filename}`, bytes });
  }
  manifestEntries.sort((a, b) => a.category.localeCompare(b.category));
  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    attribution: "OpenStreetMap contributors, ODbL",
    categories: manifestEntries,
  };
  writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`index.json written: ${manifestEntries.length} categories.`);
}

async function main() {
  if (process.argv.includes("--manifest-only")) {
    writeManifestOnly();
    return;
  }

  // --only=cafe,bank (comma-separated canonical category names) regenerates
  // a subset without re-fetching all 18 - useful when investigating a
  // single category's tag mapping.
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const wanted = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : null;
  const wants = (name) => !wanted || wanted.has(name);

  const manifestEntries = [];
  const failed = [];
  let ok = true;

  console.log("\n--- fetch + validate ---");
  for (const [category, key, value] of CATEGORY_TAGS) {
    if (!wants(category)) continue;
    console.log(`Fetching ${category} (${key}=${value})...`);
    // One category's Overpass failure (both endpoints exhausted) must not
    // abort the rest of the run - observed in practice (T-60): a transient
    // upstream 500 on one category with 17 others still healthy. Failures
    // are collected and reported so the run can be resumed with --only.
    let features;
    try {
      features = await fetchCategory(category, key, value);
    } catch (err) {
      console.log(`  FAILED: ${err.message}`);
      failed.push(category);
      await sleep(3000);
      continue;
    }
    const { filename, count, bytes } = writeCollection(category, features);
    const problems = validate(category, features);
    // A mirror that returns HTTP 200 with zero elements (a country-scoped
    // instance silently missing Taipei entirely, say) looks identical to a
    // genuinely empty category otherwise - flag it instead of writing an
    // empty file marked "OK" and moving on. Every canonical category is
    // expected to have at least one named match in Taipei.
    if (count === 0) problems.push("0 features - check which endpoint answered this query");
    if (problems.length) ok = false;
    console.log(`  ${filename}: ${count} features, ${(bytes / 1024).toFixed(1)} KB${problems.length ? "" : ", OK"}`);
    for (const p of problems) console.log(`  PROBLEM: ${p}`);
    manifestEntries.push({ category, count, file: `/data/tier2/${filename}`, bytes });
    await sleep(3000); // pace requests between categories, Overpass fair-use
  }

  if (failed.length) {
    ok = false;
    console.log(`\n${failed.length} categories failed and were skipped: ${failed.join(", ")}`);
    console.log(`Resume with: node scripts/fetch-tier2.mjs --only=${failed.join(",")}`);
  }

  if (wanted) {
    console.log(
      "\n--only was used: index.json is NOT rewritten (it would drop the categories skipped this run). " +
        "Run without --only to regenerate the full manifest.",
    );
  } else {
    manifestEntries.sort((a, b) => a.category.localeCompare(b.category));
    const manifest = {
      generated: new Date().toISOString().slice(0, 10),
      attribution: "OpenStreetMap contributors, ODbL",
      categories: manifestEntries,
    };
    writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`\nindex.json written: ${manifestEntries.length} categories.`);
  }

  console.log(ok ? "\nAll checks passed." : "\nSome checks FAILED (see above).");
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
