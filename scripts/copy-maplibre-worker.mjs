/**
 * Copy MapLibre's worker bundle into public/ before dev/build.
 *
 * Why: MapLibre 6 resolves its tile worker with `new URL(name, import.meta.url)`;
 * Turbopack rewrites `import.meta.url` so the lookup yields "" and the worker
 * never starts (style loads, zero tile requests, `load` never fires). We serve
 * the worker from /maplibre/ instead (see setWorkerUrl in MapCanvas.tsx).
 * Copying at build time keeps the files in lockstep with the installed
 * maplibre-gl version; public/maplibre/ is gitignored.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "node_modules", "maplibre-gl", "dist");
const dest = path.join(root, "public", "maplibre");
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(path.join(src, f), path.join(dest, f));
console.log(`copied ${files.join(", ")} -> public/maplibre/`);
