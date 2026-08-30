"use client";

import { useMemo, useState } from "react";
import type { FeatureCategory } from "@/lib/data/schema";
import { useMapStore } from "@/lib/store/map-store";
import { CATEGORY_PLURAL, LEGEND_ORDER } from "./category-labels";
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

function Chip({ category, count }: { category: FeatureCategory; count: number }) {
  return (
    <span className="lg-chip" data-testid="legend-popover-item" data-category={category}>
      <Swatch category={category} />
      <span className="lg-name">{CATEGORY_PLURAL[category]}</span>
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
 * (only the selected ones are, as beads — see `bead-style.ts`). Folding 31k
 * unpainted features into "places" would name a legend entry that has no
 * colour and no dots on the map. What is loaded but unpainted is disclosed one row above by
 * `LoadedCategories`; the exact machine total, matching `get_map_state`'s
 * `features_loaded`, is in the state overlay.
 *
 * One pill at every width, with the six rows in a popover behind it. The
 * always-open strip that used to run along the bottom at ≥1241px is gone with
 * the rest of the dashboard: a landing map states its scale ("2,063 places")
 * and unfolds the key when asked, rather than spending the bottom of the
 * screen on a table nobody opened.
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

      <div className={`legend-pillbox${open ? " open" : ""}`}>
        <div className="legend-pop lg deep" data-testid="legend-popover">
          {LEGEND_ORDER.map((category) => (
            <Chip key={category} category={category} count={counts.get(category) ?? 0} />
          ))}
        </div>
        <button
          type="button"
          className="legend-pill lg lens"
          data-testid="legend-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="legend-total" data-testid="legend-total">
            {number(total)} places
          </span>
          <span aria-hidden className="legend-dots">
            {LEGEND_ORDER.filter((c) => c !== "district").map((category) => (
              <i key={category} style={{ backgroundColor: CATEGORY_COLOR[category] }} />
            ))}
          </span>
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
