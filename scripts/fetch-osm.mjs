#!/usr/bin/env node
/**
 * Fetch OpenStreetMap data for GlassMap via the Overpass API.
 *
 * Preparation-time only: this script is run manually by the data engineer
 * to regenerate public/data/*.geojson. The running app never calls Overpass.
 *
 * Usage: node scripts/fetch-osm.mjs
 *
 * Produces (in public/data/):
 *   mrt-stations.geojson  - Taipei Metro station points, deduped by name
 *   districts.geojson     - Taipei City's 12 administrative districts (polygons)
 *   parks.geojson         - leisure=park / leisure=garden ways+relations, >= 2000 m^2
 *   schools.geojson       - amenity=school, centroid points
 *   supermarkets.geojson  - shop=supermarket, centroid points
 *
 * Run scripts/make-listings.mjs afterwards to generate the fabricated
 * listings.geojson (it reads mrt-stations.geojson and districts.geojson).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "data");
mkdirSync(OUT_DIR, { recursive: true });

// Taipei City bounding box, Overpass order: south,west,north,east.
const BBOX = "24.96,121.45,25.21,121.67";
const BBOX_NUM = { minLng: 121.45, minLat: 24.96, maxLng: 121.67, maxLat: 25.21 };

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// The 12 Taipei City district relations (boundary=administrative,
// admin_level=7 - confirmed by querying all admin_level 6/7 relations in
// the bbox: every match in Taipei City proper came back admin_level=7;
// New Taipei City's surrounding districts are also admin_level=7, so
// district identity is pinned by relation id below rather than by area
// name, which avoids Traditional-Chinese "臺" vs "台" ambiguity).
const DISTRICT_RELATIONS = [
  2782528, // 萬華區 Wanhua
  2783061, // 中正區 Zhongzheng
  2822029, // 中山區 Zhongshan
  2822030, // 大同區 Datong
  2869465, // 大安區 Da'an
  2881027, // 信義區 Xinyi
  2881028, // 南港區 Nangang
  2881029, // 松山區 Songshan
  2881105, // 文山區 Wenshan
  2905064, // 北投區 Beitou
  2905065, // 內湖區 Neihu
  2905066, // 士林區 Shilin
];

const round5 = (n) => Math.round(n * 1e5) / 1e5;
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

/** POST an Overpass QL query, retrying on 429/504 with backoff and falling back to a mirror. */
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

function pickTags(tags, keys) {
  if (!tags) return undefined;
  const out = {};
  for (const k of keys) {
    if (typeof tags[k] === "string") out[k] = tags[k];
  }
  return Object.keys(out).length ? out : undefined;
}

// --- polygon assembly (Overpass "out geom" returns raw way geometry; ways
// belonging to a relation must be joined end-to-end into closed rings) ---

function coordsEqual(a, b, eps = 1e-7) {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}

function assembleRings(segments) {
  const remaining = segments.filter((s) => s && s.length > 1).map((s) => s.slice());
  const rings = [];
  while (remaining.length) {
    let ring = remaining.shift();
    let guard = 0;
    while (!coordsEqual(ring[0], ring[ring.length - 1]) && remaining.length && guard < 5000) {
      guard++;
      const tail = ring[ring.length - 1];
      const head = ring[0];
      let matched = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        if (coordsEqual(seg[0], tail)) {
          ring = ring.concat(seg.slice(1));
          remaining.splice(i, 1);
          matched = true;
          break;
        }
        if (coordsEqual(seg[seg.length - 1], tail)) {
          ring = ring.concat(seg.slice(0, -1).reverse());
          remaining.splice(i, 1);
          matched = true;
          break;
        }
        if (coordsEqual(seg[seg.length - 1], head)) {
          ring = seg.slice(0, -1).concat(ring);
          remaining.splice(i, 1);
          matched = true;
          break;
        }
        if (coordsEqual(seg[0], head)) {
          ring = seg.slice(1).reverse().concat(ring);
          remaining.splice(i, 1);
          matched = true;
          break;
        }
      }
      if (!matched) break;
    }
    rings.push(ring);
  }
  return rings;
}

function closeRing(ring) {
  if (ring.length < 4) return null;
  if (coordsEqual(ring[0], ring[ring.length - 1])) return ring;
  return [...ring, ring[0]];
}

/** Build a Polygon or MultiPolygon geometry from assembled outer/inner rings. */
function buildPolygon(outerRingsRaw, innerRingsRaw) {
  const outerRings = outerRingsRaw.map(closeRing).filter(Boolean);
  const innerRings = innerRingsRaw.map(closeRing).filter(Boolean);
  if (outerRings.length === 0) return null;
  if (outerRings.length === 1) {
    return { type: "Polygon", coordinates: [outerRings[0], ...innerRings] };
  }
  const polys = outerRings.map((outer) => ({ outer, holes: [] }));
  for (const hole of innerRings) {
    const pt = turf.point(hole[0]);
    const owner = polys.find((p) => turf.booleanPointInPolygon(pt, turf.polygon([p.outer])));
    (owner ?? polys[0]).holes.push(hole);
  }
  return { type: "MultiPolygon", coordinates: polys.map((p) => [p.outer, ...p.holes]) };
}

function wayOrRelationToPolygon(el) {
  if (el.type === "way") {
    if (!el.geometry || el.geometry.length < 4) return null;
    const ring = closeRing(el.geometry.map((p) => [p.lon, p.lat]));
    return ring ? { type: "Polygon", coordinates: [ring] } : null;
  }
  if (el.type === "relation") {
    const outerSegs = [];
    const innerSegs = [];
    for (const m of el.members ?? []) {
      if (m.type !== "way" || !m.geometry) continue;
      const coords = m.geometry.map((p) => [p.lon, p.lat]);
      if (m.role === "inner") innerSegs.push(coords);
      else outerSegs.push(coords);
    }
    return buildPolygon(assembleRings(outerSegs), assembleRings(innerSegs));
  }
  return null;
}

function clipToBbox(geometry) {
  const bbox = [BBOX_NUM.minLng, BBOX_NUM.minLat, BBOX_NUM.maxLng, BBOX_NUM.maxLat];
  const clipped = turf.bboxClip(turf.feature(geometry), bbox);
  return clipped.geometry;
}

function simplifyGeometry(geometry, tolerance = 0.00012) {
  const simplified = turf.simplify(turf.feature(geometry), { tolerance, highQuality: true });
  return simplified.geometry;
}

function roundGeometry(geometry) {
  const depthByType = { Point: 0, LineString: 1, Polygon: 2, MultiPolygon: 3 };
  const depth = depthByType[geometry.type];
  const roundPos = (pos) => [round5(pos[0]), round5(pos[1])];
  const walk = (coords, d) => (d === 0 ? roundPos(coords) : coords.map((c) => walk(c, d - 1)));
  return { type: geometry.type, coordinates: walk(geometry.coordinates, depth) };
}

// --- category fetchers ---

async function fetchMrtStations() {
  const ql = `[out:json][timeout:90];
(
  node["railway"="station"]["station"="subway"](${BBOX});
  node["railway"="station"]["subway"="yes"](${BBOX});
  node["railway"="station"]["network"~"Taipei Metro|臺北捷運|Taipei Rapid Transit"](${BBOX});
);
out body;`;
  const data = await overpassQuery(ql);
  const nodes = data.elements.filter((e) => e.type === "node");

  const groups = new Map();
  for (const n of nodes) {
    const name = n.tags?.name ?? n.tags?.["name:en"] ?? `node ${n.id}`;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(n);
  }

  const features = [];
  for (const [name, group] of groups) {
    const lng = round5(group.reduce((s, n) => s + n.lon, 0) / group.length);
    const lat = round5(group.reduce((s, n) => s + n.lat, 0) / group.length);
    if (!inBbox(lng, lat)) continue;
    const rep = [...group].sort((a, b) => a.id - b.id)[0];
    const id = `osm:node:${rep.id}`;
    const tags = pickTags(rep.tags, ["network", "operator"]);
    features.push({
      type: "Feature",
      properties: {
        id,
        name,
        ...(rep.tags?.["name:en"] ? { nameEn: rep.tags["name:en"] } : {}),
        category: "mrt_station",
        source: "osm",
        ...(tags ? { tags } : {}),
      },
      geometry: { type: "Point", coordinates: [lng, lat] },
    });
  }
  return features;
}

function districtSlug(nameEn) {
  return nameEn
    .replace(/\s+District$/i, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

async function fetchDistricts() {
  const ql = `[out:json][timeout:90];
rel(id:${DISTRICT_RELATIONS.join(",")});
out geom;`;
  const data = await overpassQuery(ql);

  const features = [];
  for (const rel of data.elements) {
    if (rel.type !== "relation") continue;
    let geometry = wayOrRelationToPolygon(rel);
    if (!geometry) {
      console.warn(`  district relation ${rel.id} (${rel.tags?.name}) produced no polygon, skipping`);
      continue;
    }
    geometry = roundGeometry(simplifyGeometry(clipToBbox(geometry)));
    const name = rel.tags.name;
    const nameEn = rel.tags["name:en"];
    const id = `district:${districtSlug(nameEn ?? name)}`;
    features.push({
      type: "Feature",
      properties: {
        id,
        name,
        ...(nameEn ? { nameEn } : {}),
        category: "district",
        source: "osm",
        ...(pickTags(rel.tags, ["admin_level"]) ? { tags: pickTags(rel.tags, ["admin_level"]) } : {}),
      },
      geometry,
    });
  }
  return features;
}

async function fetchParks() {
  const ql = `[out:json][timeout:90];
(
  way["leisure"="park"](${BBOX});
  way["leisure"="garden"](${BBOX});
  relation["leisure"="park"](${BBOX});
  relation["leisure"="garden"](${BBOX});
);
out geom;`;
  const data = await overpassQuery(ql);

  const features = [];
  for (const el of data.elements) {
    const rawGeometry0 = wayOrRelationToPolygon(el);
    if (!rawGeometry0) continue;
    const rawGeometry = clipToBbox(rawGeometry0);
    if (!rawGeometry.coordinates?.length) continue;
    const areaM2 = turf.area(rawGeometry);
    if (areaM2 < 2000) continue;

    const geometry = roundGeometry(simplifyGeometry(rawGeometry));
    const name = el.tags?.name ?? el.tags?.["name:en"] ?? `Park ${el.id}`;
    const nameEn = el.tags?.["name:en"];
    const id = `osm:${el.type}:${el.id}`;
    features.push({
      type: "Feature",
      properties: {
        id,
        name,
        ...(nameEn ? { nameEn } : {}),
        category: "park",
        source: "osm",
      },
      geometry,
    });
  }
  return features;
}

async function fetchPoiCenters(key, value, category, extraTagKeys, levelFromName) {
  const ql = `[out:json][timeout:90];
(
  node["${key}"="${value}"](${BBOX});
  way["${key}"="${value}"](${BBOX});
  relation["${key}"="${value}"](${BBOX});
);
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
    lng = round5(lng);
    lat = round5(lat);
    if (!inBbox(lng, lat)) continue;

    const name = el.tags?.name ?? el.tags?.["name:en"] ?? `${category} ${el.id}`;
    const nameEn = el.tags?.["name:en"];
    const id = `osm:${el.type}:${el.id}`;
    const tags = pickTags(el.tags, extraTagKeys) ?? {};
    if (levelFromName && levelFromName(name, el.tags)) tags.level = "elementary";

    features.push({
      type: "Feature",
      properties: {
        id,
        name,
        ...(nameEn ? { nameEn } : {}),
        category,
        source: "osm",
        ...(Object.keys(tags).length ? { tags } : {}),
      },
      geometry: { type: "Point", coordinates: [lng, lat] },
    });
  }
  return features;
}

const isElementarySchool = (name, tags) =>
  /國小|國民小學/.test(name) || tags?.["school:type"] === "primary" || tags?.isced?.split(";").includes("1");

function writeCollection(filename, features) {
  const json = JSON.stringify({ type: "FeatureCollection", features });
  writeFileSync(join(OUT_DIR, filename), json);
  return { count: features.length, bytes: Buffer.byteLength(json) };
}

function validate(filename, features) {
  const ids = new Set();
  const problems = [];
  for (const f of features) {
    const [lng, lat] = f.geometry.type === "Point" ? f.geometry.coordinates : turf.centroid(f.geometry).geometry.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) problems.push(`${f.properties.id}: NaN coordinate`);
    else if (!inBbox(lng, lat)) problems.push(`${f.properties.id}: out of bbox (${lng},${lat})`);
    if (ids.has(f.properties.id)) problems.push(`${f.properties.id}: duplicate id within ${filename}`);
    ids.add(f.properties.id);
  }
  return problems;
}

async function main() {
  const results = {};

  console.log("Fetching MRT stations...");
  results.mrt = await fetchMrtStations();
  await sleep(1000);

  console.log("Fetching districts...");
  results.districts = await fetchDistricts();
  await sleep(1000);

  console.log("Fetching parks...");
  results.parks = await fetchParks();
  await sleep(1000);

  console.log("Fetching schools...");
  results.schools = await fetchPoiCenters("amenity", "school", "school", ["operator"], isElementarySchool);
  await sleep(1000);

  console.log("Fetching supermarkets...");
  results.supermarkets = await fetchPoiCenters("shop", "supermarket", "supermarket", ["operator"]);

  const files = [
    ["mrt-stations.geojson", results.mrt],
    ["districts.geojson", results.districts],
    ["parks.geojson", results.parks],
    ["schools.geojson", results.schools],
    ["supermarkets.geojson", results.supermarkets],
  ];

  console.log("\n--- validation ---");
  const allIds = new Set();
  let ok = true;
  for (const [filename, features] of files) {
    const { count, bytes } = writeCollection(filename, features);
    const problems = validate(filename, features);
    for (const f of features) {
      if (allIds.has(f.properties.id)) {
        problems.push(`${f.properties.id}: duplicate id across files`);
      }
      allIds.add(f.properties.id);
    }
    if (problems.length) ok = false;
    console.log(
      `${filename}: ${count} features, ${(bytes / 1024).toFixed(1)} KB${problems.length ? "" : ", OK"}`,
    );
    for (const p of problems) console.log(`  PROBLEM: ${p}`);
  }
  console.log(ok ? "All checks passed." : "Some checks FAILED (see above).");
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
