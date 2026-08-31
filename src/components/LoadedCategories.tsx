"use client";

import { useMemo } from "react";
import { useMapStore } from "@/lib/store/map-store";
import { useBrowseStore } from "./browse-store";
import { TIER2_PLURAL } from "./category-labels";
import { loadedCategoryRows } from "./tier2-disclosure";

const number = (n: number) => n.toLocaleString("en-US");

/**
 * Which point-of-interest categories are in memory, and how many places each
 * one holds.
 *
 * This is disclosure, not decoration. Tier-2 ships unpainted — a loaded
 * category is 500-3,200 dots the calm ramp was never designed for — so without
 * this row the whole city's cafes can be searchable while the screen looks
 * exactly as it did before, and the human has no way to know why the agent
 * suddenly answers cafe questions. One quiet line in the bottom bar closes that
 * gap, and it is the honest counterpart of the map key in the Places tray: the
 * key counts what is painted, this counts what is only queryable.
 *
 * It stays out here, in the corner the legend pill used to hold, rather than
 * following the key into the tray. A disclosure that only appears once you open
 * something is not a disclosure — the whole failure it answers is a person who
 * has no reason to suspect anything changed.
 *
 * Renders nothing at all until a category loads, so the landing state is
 * byte-identical to before it existed.
 *
 * The names are the words a person reads (`TIER2_PLURAL`), not the OSM tags
 * underneath them: this row sits in the human chrome, and "place_of_worship" is
 * a tag rather than a kind of place. The agent's own
 * vocabulary — the enum value it must be handed back — is what the Places tray
 * and the tools carry; a disclosure aimed at the person watching the screen is
 * not the place to make them read snake_case. `data-category` still carries
 * the tag verbatim, so a test (and anything reading the DOM) keeps the exact
 * name the tools take.
 */
export function LoadedCategories() {
  const loaded = useMapStore((s) => s.tier2Loaded);
  const features = useMapStore((s) => s.tier2Features);
  // A browsed category is painted, and the Places dock already names it with
  // its count — so it belongs to the painted half of the split, not to this
  // one. What is left here is exactly what the row claims to be: loaded, and
  // invisible. Up to three of them can be painted at once, so this is a set
  // subtraction rather than one name.
  const browsing = useBrowseStore((s) => s.categories);
  const rows = useMemo(
    () => loadedCategoryRows(loaded, features).filter((row) => !browsing.includes(row.category)),
    [loaded, features, browsing],
  );

  if (rows.length === 0) return null;

  return (
    <div className="poi-strip lg" data-testid="poi-loaded">
      <span className="poi-strip-label">POI loaded</span>
      {rows.map((row) => (
        <span
          key={row.category}
          className="poi-chip"
          data-testid="poi-loaded-item"
          data-category={row.category}
        >
          <span className="poi-cat">{TIER2_PLURAL[row.category]}</span>
          <span className="poi-n">{number(row.count)}</span>
        </span>
      ))}
    </div>
  );
}
