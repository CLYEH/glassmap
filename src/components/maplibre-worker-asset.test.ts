import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `MapCanvas` points MapLibre's worker at `public/maplibre/*` because Turbopack
 * breaks MapLibre's own `import.meta.url` worker lookup. A copy that drifts from
 * the installed version means a worker protocol mismatch: the map would load a
 * style, request no tiles and never fire `load` — a silent blank map.
 * This test is the only thing that notices when maplibre-gl is upgraded.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const COPIES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

describe("vendored MapLibre worker", () => {
  for (const name of COPIES) {
    it(`public/maplibre/${name} is byte-identical to the installed maplibre-gl`, () => {
      const installed = readFileSync(path.join(ROOT, "node_modules/maplibre-gl/dist", name));
      const served = readFileSync(path.join(ROOT, "public/maplibre", name));
      expect(served.equals(installed)).toBe(true);
    });
  }
});
