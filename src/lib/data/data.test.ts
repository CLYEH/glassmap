/**
 * Regression guard for the committed public/data/*.geojson files: reads
 * them from disk (not through loadDatasets) and checks the data contract
 * in schema.ts directly, so a bad regeneration is caught in CI even if the
 * loader's own logic is untouched.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { booleanPointInPolygon, point } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { DATASETS, FEATURE_CATEGORIES, type FeatureCategory } from "./schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/lib/data -> repo root -> public/data
const PUBLIC_DATA_DIR = join(__dirname, "..", "..", "..", "public", "data");

const BBOX = { minLng: 121.45, minLat: 24.96, maxLng: 121.67, maxLat: 25.21 };

const ALLOWED_PROPERTY_KEYS = new Set(["id", "name", "nameEn", "category", "source", "sample", "tags"]);

const ID_PATTERN: Record<FeatureCategory, RegExp> = {
  mrt_station: /^osm:(node|way|relation):\d+$/,
  park: /^osm:(node|way|relation):\d+$/,
  school: /^osm:(node|way|relation):\d+$/,
  supermarket: /^osm:(node|way|relation):\d+$/,
  listing: /^listing:\d{2}$/,
  district: /^district:[a-z]+$/,
};

function filePathFor(category: FeatureCategory): string {
  const basename = DATASETS[category].file.replace(/^\/data\//, "");
  return join(PUBLIC_DATA_DIR, basename);
}

function readGeojson(category: FeatureCategory) {
  const raw = readFileSync(filePathFor(category), "utf8");
  return JSON.parse(raw) as { type: string; features: Array<{ properties: Record<string, unknown>; geometry: GeoJSON.Geometry }> };
}

/** Every coordinate pair a geometry contains, regardless of nesting depth. */
function collectCoords(geometry: GeoJSON.Geometry): Array<[number, number]> {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates as [number, number]];
    case "Polygon":
      return geometry.coordinates.flat(1) as Array<[number, number]>;
    case "MultiPolygon":
      return geometry.coordinates.flat(2) as Array<[number, number]>;
    default:
      throw new Error(`unexpected geometry type in data file: ${geometry.type}`);
  }
}

const isWithin5Decimals = (n: number) => Math.abs(n - Math.round(n * 1e5) / 1e5) < 1e-9;

const coordsEqual = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** GeoJSON polygon geometries as a Polygon[] regardless of Polygon/MultiPolygon wrapping. */
function polygonsOf(geometry: GeoJSON.Geometry): GeoJSON.Position[][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

describe("public/data/*.geojson contract", () => {
  for (const category of FEATURE_CATEGORIES) {
    describe(DATASETS[category].file, () => {
      const collection = readGeojson(category);

      it("every feature declares this file's category", () => {
        for (const f of collection.features) {
          expect(f.properties.category).toBe(category);
        }
      });

      it("every feature's property keys are a subset of the allowed set", () => {
        for (const f of collection.features) {
          for (const key of Object.keys(f.properties)) {
            expect(ALLOWED_PROPERTY_KEYS.has(key)).toBe(true);
          }
        }
      });

      it("every id matches the category's id format", () => {
        for (const f of collection.features) {
          expect(f.properties.id).toMatch(ID_PATTERN[category]);
        }
      });

      it("every source is osm or sample", () => {
        for (const f of collection.features) {
          expect(["osm", "sample"]).toContain(f.properties.source);
        }
      });

      it("sample is true iff the feature is a listing", () => {
        for (const f of collection.features) {
          if (category === "listing") {
            expect(f.properties.sample).toBe(true);
          } else {
            expect(f.properties.sample).toBeFalsy();
          }
        }
      });

      it("every coordinate is rounded to <=5 decimals and inside the Taipei bbox", () => {
        for (const f of collection.features) {
          for (const [lng, lat] of collectCoords(f.geometry)) {
            expect(isWithin5Decimals(lng)).toBe(true);
            expect(isWithin5Decimals(lat)).toBe(true);
            expect(lng).toBeGreaterThanOrEqual(BBOX.minLng);
            expect(lng).toBeLessThanOrEqual(BBOX.maxLng);
            expect(lat).toBeGreaterThanOrEqual(BBOX.minLat);
            expect(lat).toBeLessThanOrEqual(BBOX.maxLat);
          }
        }
      });

      it("is under the 300 KB per-file budget", () => {
        expect(statSync(filePathFor(category)).size).toBeLessThan(300_000);
      });

      it("every Polygon/MultiPolygon is well-formed (no empty parts, every ring closed)", () => {
        for (const f of collection.features) {
          if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;
          const polygons = polygonsOf(f.geometry);
          expect(polygons.length).toBeGreaterThanOrEqual(1);
          for (const polygon of polygons) {
            expect(polygon.length).toBeGreaterThanOrEqual(1);
            for (const ring of polygon) {
              expect(ring.length).toBeGreaterThanOrEqual(4);
              expect(coordsEqual(ring[0] as [number, number], ring[ring.length - 1] as [number, number])).toBe(true);
            }
          }
        }
      });
    });
  }

  it("has unique ids across all six files", () => {
    const seen = new Set<string>();
    for (const category of FEATURE_CATEGORIES) {
      for (const f of readGeojson(category).features) {
        const id = f.properties.id as string;
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  it("all six files together are under the 1 MB combined budget", () => {
    const total = FEATURE_CATEGORIES.reduce((sum, category) => sum + statSync(filePathFor(category)).size, 0);
    expect(total).toBeLessThan(1_000_000);
  });

  describe("district boundary sanity (T-24: guard against polygon overshoot)", () => {
    const districts = readGeojson("district").features;
    const districtsContaining = (lng: number, lat: number) =>
      districts.filter((f) => booleanPointInPolygon(point([lng, lat]), f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon));

    it("Banqiao Station (New Taipei, across the river from Wanhua) is inside no Taipei district", () => {
      // 121.4618,25.0132 - verified against OSM's own Nominatim reverse
      // geocoder (2026-08-28): "MRT Banqiao Station Exit 1, Banqiao
      // District, New Taipei". A coarse district polygon can bulge across
      // the Xindian/Dahan river here and wrongly claim this point for a
      // Taipei district (describe_surroundings would then confidently name
      // a Taipei district for a New Taipei location).
      expect(districtsContaining(121.4618, 25.0132)).toHaveLength(0);
    });

    it("Taipei 101 is inside exactly one district (Xinyi)", () => {
      const hits = districtsContaining(121.5645, 25.033);
      expect(hits).toHaveLength(1);
      expect(hits[0].properties.id).toBe("district:xinyi");
    });
  });
});
