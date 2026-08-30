"use client";

import { useMemo } from "react";
import { useMapStore } from "@/lib/store/map-store";
import { useBrowseStore } from "./browse-store";
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
 * suddenly answers cafe questions. One quiet line above the legend closes that
 * gap, and it is the honest counterpart of the legend beneath it: the legend
 * counts what is painted, this counts what is only queryable.
 *
 * Renders nothing at all until a category loads, so the landing state is
 * byte-identical to before it existed.
 *
 * The category names are the agent's own vocabulary, verbatim and in the data
 * face: `cafe`, not "Cafes". They are the enum values the tools take, so a
 * person reading this row can say one back to the agent and be understood —
 * the handoff's machine-voice-in-mono rule, in the one place on screen where
 * the reader might want to speak the machine's words.
 */
export function LoadedCategories() {
  const loaded = useMapStore((s) => s.tier2Loaded);
  const features = useMapStore((s) => s.tier2Features);
  // The browsed category is painted, and the Places dock already names it with
  // its count — so it belongs to the legend's half of the split, not to this
  // one. What is left here is exactly what the row claims to be: loaded, and
  // invisible.
  const browsing = useBrowseStore((s) => s.category);
  const rows = useMemo(
    () => loadedCategoryRows(loaded, features).filter((row) => row.category !== browsing),
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
          <span className="poi-cat">{row.category}</span>
          <span className="poi-n">{number(row.count)}</span>
        </span>
      ))}
    </div>
  );
}
