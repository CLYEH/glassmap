"use client";

import { useEffect } from "react";
import { DATASETS, isFeatureCategory, type GlassMapFeature } from "@/lib/data/schema";
import { useMapStore } from "@/lib/store/map-store";

/**
 * Keep only features the map can actually draw and the tools can key on, so the
 * `feature-count` an agent reads matches what is on screen: a string id, a known
 * category and a geometry. Anything else is dropped rather than counted.
 */
function isRenderableFeature(x: unknown): x is GlassMapFeature {
  if (typeof x !== "object" || x === null) return false;
  const f = x as { geometry?: unknown; properties?: { id?: unknown; category?: unknown } };
  return (
    !!f.geometry &&
    typeof f.properties?.id === "string" &&
    isFeatureCategory(f.properties?.category)
  );
}

/**
 * A dataset that has not been produced yet simply contributes nothing:
 * `public/data/*.geojson` lands in a separate PR, and a 404 must not break
 * the map, the overlay or the tools.
 */
async function loadCollection(file: string): Promise<GlassMapFeature[]> {
  try {
    const response = await fetch(file);
    if (!response.ok) return [];
    const json: unknown = await response.json();
    const features = (json as { features?: unknown }).features;
    return Array.isArray(features) ? features.filter(isRenderableFeature) : [];
  } catch {
    return [];
  }
}

/** Loads every dataset once and hands the flat feature list to the store. */
export function useFeatureData() {
  const setFeatures = useMapStore((s) => s.setFeatures);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const collections = await Promise.all(
        Object.values(DATASETS).map((dataset) => loadCollection(dataset.file)),
      );
      if (!cancelled) setFeatures(collections.flat());
    })();
    return () => {
      cancelled = true;
    };
  }, [setFeatures]);
}
