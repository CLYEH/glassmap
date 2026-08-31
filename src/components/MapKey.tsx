"use client";

import { useMemo } from "react";
import type { FeatureCategory } from "@/lib/data/schema";
import { useMapStore } from "@/lib/store/map-store";
import { CATEGORY_PLURAL } from "./category-labels";
import { CATEGORY_COLOR } from "./map-style";
import { bundledKeyRows } from "./places-model";

const number = (n: number) => n.toLocaleString("en-US");

function Swatch({ category }: { category: FeatureCategory }) {
  // Districts are outlines on the map, so their swatch is a ring; the white
  // outer ring on every swatch mirrors the map's own white circle-stroke.
  if (category === "district") return <span aria-hidden className="lg-dot ring" />;
  return (
    <span aria-hidden className="lg-dot" style={{ backgroundColor: CATEGORY_COLOR[category] }} />
  );
}

/**
 * What the coloured dots on the map mean, and how many of each are loaded —
 * counted from the store, so it can never advertise data the map is not
 * holding. "Places" is the human word for what the tools call features.
 *
 * Until the bundled data lands the rows say "…", the same "not counted yet" the
 * dock pill says and for the same reason: six confident zeros are a lie during
 * load, and worse than a lie beside a pill that has just admitted it does not
 * know yet — this is the surface whose job is to account for that number.
 *
 * The first section of the Places tray ("Already here"), above the eighteen
 * categories a tap can load ("More places"). Both are the same question — what
 * places are there? — and they used to be answered by two surfaces on the same
 * edge of the screen: a pill bottom-left and a tray bottom-centre. One tray
 * answers it once, in the order a person needs it: here is what is already on
 * the map, and here is what else you can put on it.
 *
 * The two halves count different things and must never be added together. These
 * six rows are the six bundled datasets, painted; the counts below are the
 * manifest's, for files that have not been fetched. The dock pill's total is
 * this half only — `bundledKeyRows` sums to it exactly — so loading 31,000
 * cafés does not move it. What is loaded but unpainted is disclosed by
 * `LoadedCategories` in the bottom bar; the exact machine total, matching
 * `get_map_state`'s `features_loaded`, is in the state overlay.
 */
export function MapKey() {
  const features = useMapStore((s) => s.features);
  const rows = useMemo(() => bundledKeyRows(features), [features]);
  const counted = features.length > 0;

  return (
    <section className="tray-sec" data-testid="legend">
      <div className="tray-sec-head">
        {/* Not "On the map", which this map already spends on two other things
            — the inspector's heading and the card a tap opens. A person reading
            the same three words on three surfaces has to work out which one
            they are on. */}
        <h4>Already here</h4>
        <span>what the colours mean</span>
      </div>
      <div className="map-key">
        {rows.map(({ category, count }) => (
          <span
            key={category}
            className="lg-chip"
            data-testid="legend-item"
            data-category={category}
          >
            <Swatch category={category} />
            <span className="lg-name">{CATEGORY_PLURAL[category]}</span>
            <span className="lg-n">{counted ? number(count) : "…"}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
