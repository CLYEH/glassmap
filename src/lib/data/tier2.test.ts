/**
 * Regression guard for public/data/tier2/*.geojson and its index.json
 * manifest (T-60). The tool layer is expected to read index.json for
 * per-category counts/sizes without loading every 2-2591 KB file, so if
 * the manifest ever drifts from the files on disk (e.g. a file is
 * regenerated but the manifest isn't, or vice versa) the tool layer would
 * silently report stale counts/sizes with no way to notice. This is
 * exactly the drift class that produced the stale Size column in
 * public/data/README.md fixed alongside this test - encoding it as a test
 * keeps it from recurring silently.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/lib/data -> repo root -> public/data/tier2
const TIER2_DIR = join(__dirname, "..", "..", "..", "public", "data", "tier2");

const BBOX = { minLng: 121.45, minLat: 24.96, maxLng: 121.67, maxLat: 25.21 };

// Canonical set from scripts/fetch-tier2.mjs's own doc comment ("do not
// rename, the tool layer will be coded against these exact strings").
// Kept here too so a category silently dropped from (or added to)
// index.json is caught even though nothing in src/ imports the .mjs script.
const CANONICAL_CATEGORIES = [
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
].sort();

const ALLOWED_PROPERTY_KEYS = new Set(["id", "name", "category", "nameEn", "cuisine", "brand", "opening_hours"]);

const ID_PATTERN = /^osm:(node|way|relation):\d+$/;

const isWithin6Decimals = (n: number) => Math.abs(n - Math.round(n * 1e6) / 1e6) < 1e-9;

interface ManifestEntry {
  category: string;
  count: number;
  file: string;
  bytes: number;
}

interface Manifest {
  generated: string;
  attribution: string;
  categories: ManifestEntry[];
}

interface Tier2Feature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: [number, number] };
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(TIER2_DIR, "index.json"), "utf8")) as Manifest;
}

function readCategoryFile(category: string): { features: Tier2Feature[] } {
  const raw = readFileSync(join(TIER2_DIR, `${category}.geojson`), "utf8");
  return JSON.parse(raw) as { features: Tier2Feature[] };
}

describe("public/data/tier2/*.geojson contract (T-60)", () => {
  const manifest = readManifest();

  it("index.json lists exactly the 18 canonical categories, no more, no fewer", () => {
    expect(manifest.categories.map((c) => c.category).sort()).toEqual(CANONICAL_CATEGORIES);
  });

  for (const entry of manifest.categories) {
    describe(`${entry.category}.geojson`, () => {
      const collection = readCategoryFile(entry.category);

      it("index.json's count matches the actual feature count in the file", () => {
        expect(collection.features.length).toBe(entry.count);
      });

      it("index.json's bytes matches the actual file size on disk", () => {
        expect(statSync(join(TIER2_DIR, `${entry.category}.geojson`)).size).toBe(entry.bytes);
      });

      it("ids are sorted ascending (localeCompare) and unique within the file", () => {
        const ids = collection.features.map((f) => f.properties.id as string);
        const sorted = [...ids].sort((a, b) => a.localeCompare(b));
        expect(ids).toEqual(sorted);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("every id matches osm:(node|way|relation):<digits>", () => {
        for (const f of collection.features) {
          expect(f.properties.id).toMatch(ID_PATTERN);
        }
      });

      it("every property key is in the allow-list and every value is a non-empty string", () => {
        for (const f of collection.features) {
          for (const [key, value] of Object.entries(f.properties)) {
            expect(ALLOWED_PROPERTY_KEYS.has(key)).toBe(true);
            expect(typeof value).toBe("string");
            expect((value as string).length).toBeGreaterThan(0);
          }
        }
      });

      it("every feature's category property equals the filename stem", () => {
        for (const f of collection.features) {
          expect(f.properties.category).toBe(entry.category);
        }
      });

      it("every geometry is a Point with coords <=6dp inside the Taipei bbox", () => {
        for (const f of collection.features) {
          expect(f.geometry.type).toBe("Point");
          const [lng, lat] = f.geometry.coordinates;
          expect(isWithin6Decimals(lng)).toBe(true);
          expect(isWithin6Decimals(lat)).toBe(true);
          expect(lng).toBeGreaterThanOrEqual(BBOX.minLng);
          expect(lng).toBeLessThanOrEqual(BBOX.maxLng);
          expect(lat).toBeGreaterThanOrEqual(BBOX.minLat);
          expect(lat).toBeLessThanOrEqual(BBOX.maxLat);
        }
      });

      it("opening_hours, when present, is at most 120 characters", () => {
        for (const f of collection.features) {
          const openingHours = f.properties.opening_hours;
          if (openingHours === undefined) continue;
          expect((openingHours as string).length).toBeLessThanOrEqual(120);
        }
      });
    });
  }
});
