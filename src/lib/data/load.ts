/**
 * Loads every dataset listed in DATASETS (schema.ts) and returns the
 * concatenated features. Pure - no React, no module-level state.
 */
import { DATASETS, isFeatureCategory, type FeatureCategory, type GlassMapFeature } from "./schema";

interface RawCollection {
  features?: unknown[];
}

function isRawFeature(x: unknown): x is { properties?: { id?: unknown; category?: unknown } } {
  return typeof x === "object" && x !== null;
}

export async function loadDatasets(fetchFn: typeof fetch = fetch): Promise<GlassMapFeature[]> {
  const features: GlassMapFeature[] = [];
  const seenIds = new Set<string>();

  for (const category of Object.keys(DATASETS) as FeatureCategory[]) {
    const { file } = DATASETS[category];
    const res = await fetchFn(file);
    if (!res.ok) {
      if (res.status === 404) continue;
      throw new Error(`Failed to load ${file}: ${res.status} ${res.statusText}`);
    }

    const collection = (await res.json()) as RawCollection;
    if (!Array.isArray(collection.features)) continue;

    for (const raw of collection.features) {
      if (!isRawFeature(raw)) throw new Error(`${file}: feature is not an object`);
      const id = raw.properties?.id;
      if (typeof id !== "string") throw new Error(`${file}: feature is missing a string id`);
      if (!isFeatureCategory(raw.properties?.category)) {
        throw new Error(`${file}: feature ${id} has invalid category "${String(raw.properties?.category)}"`);
      }
      if (raw.properties.category !== category) {
        throw new Error(`${file}: feature ${id} has category "${raw.properties.category}", expected "${category}"`);
      }
      if (seenIds.has(id)) throw new Error(`Duplicate feature id across datasets: ${id}`);
      seenIds.add(id);
      features.push(raw as GlassMapFeature);
    }
  }

  return features;
}
