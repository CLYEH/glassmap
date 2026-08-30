"use client";

import { useMemo, useState } from "react";
import type { FeatureCategory } from "@/lib/data/schema";
import { useMapStore } from "@/lib/store/map-store";
import {
  CATEGORY_PLURAL,
  CATEGORY_PLURAL_SHORT,
  LEGEND_ORDER,
} from "./category-labels";
import { LoadedCategories } from "./LoadedCategories";
import { CATEGORY_COLOR } from "./map-style";

const number = (n: number) => n.toLocaleString("en-US");

function Swatch({ category }: { category: FeatureCategory }) {
  // Districts are outlines on the map, so their swatch is a ring; the white
  // outer ring on every swatch mirrors the map's own white circle-stroke.
  if (category === "district") return <span aria-hidden className="lg-dot ring" />;
  return (
    <span aria-hidden className="lg-dot" style={{ backgroundColor: CATEGORY_COLOR[category] }} />
  );
}

function Chip({
  category,
  count,
  short,
  testid,
}: {
  category: FeatureCategory;
  count: number;
  short: boolean;
  testid: string;
}) {
  const abbreviation = CATEGORY_PLURAL_SHORT[category];
  return (
    <span className="lg-chip" data-testid={testid} data-category={category}>
      <Swatch category={category} />
      <span className="lg-name">
        {short && abbreviation ? (
          <>
            <span className="lg-name-full">{CATEGORY_PLURAL[category]}</span>
            <span className="lg-name-short">{abbreviation}</span>
          </>
        ) : (
          CATEGORY_PLURAL[category]
        )}
      </span>
      <span className="lg-n">{number(count)}</span>
    </span>
  );
}

/**
 * What the coloured dots on the map mean, and how many of each are loaded —
 * counted from the store, so it can never advertise data the map is not
 * holding. "Places" is the human word for what the tools call features.
 *
 * The total stays the six bundled datasets even when point-of-interest
 * categories are loaded. This legend is a key to what is painted: its six
 * chips have to add up to the number beside them, and POIs are not painted
 * (only the selected ones are — see POI_SOURCE). Folding 31k unpainted
 * features into "places" would name a legend entry that has no colour and no
 * dots on the map. What is loaded but unpainted is disclosed one row above by
 * `LoadedCategories`; the exact machine total, matching `get_map_state`'s
 * `features_loaded`, is in the state overlay.
 *
 * Below 1241px there is no room for six labelled chips beside the badge, so it
 * collapses to the total plus a popover with the same rows (which is also the
 * only way the numbers stay readable on a phone).
 */
export function Legend() {
  const features = useMapStore((s) => s.features);
  const [open, setOpen] = useState(false);

  const counts = useMemo(() => {
    const tally = new Map<FeatureCategory, number>();
    for (const feature of features) {
      const category = feature.properties.category;
      tally.set(category, (tally.get(category) ?? 0) + 1);
    }
    return tally;
  }, [features]);

  const total = features.length;

  return (
    <div className="legend-zone" data-testid="legend">
      {/* Above the legend, and only once a category loads: the bottom bar is
          bottom-aligned, so this grows upward and the legend itself never
          moves. */}
      <LoadedCategories />

      <div className="legend-full glass">
        <span className="legend-total" data-testid="legend-total">
          {number(total)} places
        </span>
        {LEGEND_ORDER.map((category) => (
          <Chip
            key={category}
            category={category}
            count={counts.get(category) ?? 0}
            short
            testid="legend-item"
          />
        ))}
      </div>

      <div className={`legend-pillbox${open ? " open" : ""}`}>
        <div className="legend-pop glass" data-testid="legend-popover">
          {LEGEND_ORDER.map((category) => (
            <Chip
              key={category}
              category={category}
              count={counts.get(category) ?? 0}
              short={false}
              testid="legend-popover-item"
            />
          ))}
        </div>
        <button
          type="button"
          className="legend-pill glass"
          data-testid="legend-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {number(total)} places
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M3 4.8 6 7.8 9 4.8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
