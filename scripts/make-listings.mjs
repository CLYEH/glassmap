#!/usr/bin/env node
/**
 * Generate fabricated sample listings for GlassMap.
 *
 * Deterministic (seeded RNG): re-running this script produces byte-identical
 * output. Reads public/data/mrt-stations.geojson and districts.geojson, so
 * run scripts/fetch-osm.mjs first.
 *
 * Usage: node scripts/make-listings.mjs
 *
 * Produces: public/data/listings.geojson - 25 obviously-fake Point features
 * scattered near MRT stations in Daan, Zhongshan, Songshan and Xinyi
 * districts. properties.sample is always true; no real addresses or prices.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "public", "data");

const SEED = 20260828; // export date, kept fixed so output is reproducible
const COUNT = 25;
const TARGET_DISTRICT_SLUGS = ["daan", "zhongshan", "songshan", "xinyi"];

const round5 = (n) => Math.round(n * 1e5) / 1e5;

function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readCollection(filename) {
  const path = join(DATA_DIR, filename);
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Cannot read ${path} - run scripts/fetch-osm.mjs first`);
  }
  return JSON.parse(raw);
}

function main() {
  const stations = readCollection("mrt-stations.geojson");
  const districts = readCollection("districts.geojson");

  const targetDistricts = districts.features.filter((f) =>
    TARGET_DISTRICT_SLUGS.includes(f.properties.id.split(":")[1]),
  );
  if (targetDistricts.length === 0) {
    throw new Error("No target districts (daan/zhongshan/songshan/xinyi) found in districts.geojson");
  }

  const eligibleStations = stations.features.filter((f) => {
    const pt = turf.point(f.geometry.coordinates);
    return targetDistricts.some((d) => turf.booleanPointInPolygon(pt, d));
  });
  if (eligibleStations.length === 0) {
    throw new Error("No MRT stations found inside the target districts");
  }

  const MAX_SCATTER_ATTEMPTS = 20;
  const rand = mulberry32(SEED);
  const features = [];
  for (let i = 1; i <= COUNT; i++) {
    const station = eligibleStations[(i - 1) % eligibleStations.length];
    const [lng, lat] = station.geometry.coordinates;

    // Scatter 50-300m from the station at a random bearing, re-drawing (same
    // seeded RNG, so still deterministic) until the point lands inside one
    // of the target districts - a scatter can otherwise cross a district
    // border near the station. Falls back to the station's own coordinate
    // (always inside a target district, since eligibleStations is
    // pre-filtered) if no draw succeeds within the attempt cap.
    let coord = null;
    for (let attempt = 0; attempt < MAX_SCATTER_ATTEMPTS; attempt++) {
      const angle = rand() * 2 * Math.PI;
      const distanceM = 50 + rand() * 250;
      const dLng = (distanceM * Math.cos(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
      const dLat = (distanceM * Math.sin(angle)) / 110540;
      const candidate = [round5(lng + dLng), round5(lat + dLat)];
      const pt = turf.point(candidate);
      if (targetDistricts.some((d) => turf.booleanPointInPolygon(pt, d))) {
        coord = candidate;
        break;
      }
    }
    if (!coord) {
      console.warn(
        `  listing ${i}: no scatter landed in a target district after ${MAX_SCATTER_ATTEMPTS} attempts, using station coordinate`,
      );
      coord = [lng, lat];
    }

    const num = String(i).padStart(2, "0");
    features.push({
      type: "Feature",
      properties: {
        id: `listing:${num}`,
        name: `Sample listing ${num}`,
        category: "listing",
        source: "sample",
        sample: true,
      },
      geometry: { type: "Point", coordinates: coord },
    });
  }

  const json = JSON.stringify({ type: "FeatureCollection", features });
  writeFileSync(join(DATA_DIR, "listings.geojson"), json);
  console.log(`listings.geojson: ${features.length} features, ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB`);
}

main();
