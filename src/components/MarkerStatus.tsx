"use client";

import { useMemo } from "react";
import { useMapStore } from "@/lib/store/map-store";
import {
  beadAnchorsToGeoJson,
  browsePointsToGeoJson,
  browseTierMinimum,
  selectionProvenance,
} from "./bead-style";
import { useBrowseStore } from "./browse-store";
import { selectedPoiFeatures, selectionAnchorsToGeoJson } from "./map-style";

/**
 * What the marker system is currently asking the map to draw, in words.
 *
 * Beads are pixels on a WebGL canvas: there is no DOM node to assert, and the
 * e2e suite runs network-isolated, so the basemap never loads and the layers
 * are never even added. This reads the same pure functions that feed the two
 * bead sources, from the same store, so "42 beads, 3 of them the human's" is
 * checkable without a GPU and without a screenshot — the same reason
 * `map-status` exists.
 *
 * It is a mirror, not a second source of truth: every number here comes from
 * the function that produces the GeoJSON MapCanvas pushes into the source.
 */
export function MarkerStatus() {
  const selection = useMapStore((s) => s.selection);
  const features = useMapStore((s) => s.features);
  const tier2Features = useMapStore((s) => s.tier2Features);
  const zoom = useMapStore((s) => s.view.zoom);
  const sources = useMapStore(selectionProvenance);
  const category = useBrowseStore((s) => s.category);
  const loading = useBrowseStore((s) => s.loading);
  const threshold = useBrowseStore((s) => s.threshold);

  const beads = useMemo(() => {
    const poi = selectedPoiFeatures(tier2Features, selection);
    return beadAnchorsToGeoJson(poi, selection, sources).features;
  }, [tier2Features, selection, sources]);

  const rings = useMemo(
    () => selectionAnchorsToGeoJson(features, selection, sources).features.length,
    [features, selection, sources],
  );

  const browsed = useMemo(
    () => browsePointsToGeoJson(tier2Features, category, selection).features.length,
    [tier2Features, category, selection],
  );

  const human = beads.filter((f) => f.properties?.prov === "user").length;
  const counted = Number.isFinite(threshold) ? String(threshold) : "none";

  return (
    <>
      <span data-testid="bead-state" className="gm-machine">
        {`beads=${beads.length} user=${human} rings=${rings}`}
      </span>
      <span data-testid="browse-state" className="gm-machine">
        {category === null
          ? loading
            ? "loading"
            : "off"
          : `${category} places=${browsed} min=${browseTierMinimum(zoom)} counted>=${counted}`}
      </span>
    </>
  );
}
