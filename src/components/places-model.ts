import { TIER2_CATEGORIES, type Tier2Category } from "@/lib/store/tier2";
import { TIER2_PLURAL } from "./category-labels";

/**
 * The Places tray's count format: 497, 1.6k, 13.8k.
 *
 * Thousands are rounded because the tray is a menu, not a disclosure. The
 * exact figure is the one printed beside a category once it is actually
 * loaded ("Cafés · 2,297 loaded"), where it is a claim about what the map is
 * holding; here it is a sense of scale, and eighteen five-digit numerals in a
 * grid read as noise rather than as scale.
 *
 * Below 1000 the figure is exact, so nothing in the first, most crowded decade
 * of counts is ever advertised as more than it is — 999 stays 999 rather than
 * becoming "1k". Above it the tenth is rounded, not floored, so 2,297 reads as
 * "2.3k": the tray is a sense of scale and half a percent in either direction
 * is not a claim anyone acts on. The exact figure is one click away, beside the
 * category once it is loaded.
 */
export function trayCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

/**
 * The 18 categories in the order a person scans a menu — by the word they
 * read, not by the OSM tag underneath it. Sorted once at module load: the
 * list is fixed, and re-sorting it per render would hand React a new array on
 * every keystroke elsewhere in the page.
 */
export const TRAY_ORDER: readonly Tier2Category[] = [...TIER2_CATEGORIES].sort((a, b) =>
  TIER2_PLURAL[a].localeCompare(TIER2_PLURAL[b], "en"),
);
