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
  const categories = useBrowseStore((s) => s.categories);
  const pending = useBrowseStore((s) => s.pending);
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
    () => browsePointsToGeoJson(tier2Features, categories, selection).features.length,
    [tier2Features, categories, selection],
  );

  const human = beads.filter((f) => f.properties?.prov === "user").length;
  const counted = Number.isFinite(threshold) ? String(threshold) : "none";
  // The whole browsed set, in the order the human asked for it — the same
  // order the slots on the map are numbered in, so a run reading this span can
  // say which kind a mixed cluster is mixed out of. Comma-separated and never
  // sorted: "cafe,bar" and "bar,cafe" are different maps, because the second
  // one had bars painted first and cafes would be the next thing evicted.
  const browsing = categories.join(",");
  // `places` counts places, not (category, place) pairs: a bakery that also
  // serves coffee is one grain on the map under either tag, and this span is
  // the only place a headless run can check that. One `min`/`counted` pair for
  // the whole set, because the ink budget is one allowance over the screen.
  const painted = `places=${browsed} min=${browseTierMinimum(zoom)} counted>=${counted}`;

  return (
    <>
      <span data-testid="bead-state" className="gm-machine">
        {`beads=${beads.length} user=${human} rings=${rings}`}
      </span>
      <span data-testid="browse-state" className="gm-machine">
        {categories.length === 0
          ? pending.length > 0
            ? "loading"
            : "off"
          : `${browsing} ${painted}`}
      </span>
    </>
  );
}
