/**
 * "What is around me?" — the answer a person who cannot look at the map gets.
 *
 * The shape of the answer is the design: eight compass groups instead of a flat
 * list, because that is how a human gives directions out loud, and a hard cap
 * on the number of items, because this tool is called on every turn.
 */
import {
  bearing as turfBearing,
  booleanPointInPolygon,
  nearestPointOnLine,
  polygonToLine,
} from "@turf/turf";
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
import { FEATURE_CATEGORIES, type FeatureCategory, type GlassMapFeature } from "@/lib/data/schema";
import type { LngLat } from "@/lib/store/map-store";
import { COMPASS, compassFromBearing, distanceMeters, featureCenter, type Compass } from "./output";

/** A comfortable walk; the default the tool uses when nobody says otherwise. */
export const DEFAULT_SURROUNDINGS_RADIUS_M = 500;
/** Read aloud, thirty things is already a lot. */
export const SURROUNDINGS_ITEM_LIMIT = 30;
/**
 * How far the "nearest district" fallback may reach. Seams between the
 * independently simplified district polygons are ~150 m wide; anything beyond a
 * few kilometres means the origin is simply not in Taipei, and naming a
 * district there would be a confident lie.
 */
export const DISTRICT_FALLBACK_MAX_M = 5_000;

/** Everything that can be a neighbour. The district you are in is its own field. */
export const NEIGHBOUR_CATEGORIES: FeatureCategory[] = FEATURE_CATEGORIES.filter(
  (c) => c !== "district",
);

export interface SurroundingsItem {
  name: string;
  name_en?: string;
  category: FeatureCategory;
  distance_m: number;
  /** Present and true only for fabricated demo data. */
  sample?: boolean;
}

export interface SurroundingsGroup {
  direction: Compass;
  items: SurroundingsItem[];
}

/** Metres from a point to the outline of a district, or Infinity if unusable. */
function boundaryDistanceM(feature: GlassMapFeature, point: LngLat): number {
  try {
    const line = polygonToLine(feature as Feature<Polygon | MultiPolygon>);
    const lines = line.type === "FeatureCollection" ? line.features : [line];
    let best = Number.POSITIVE_INFINITY;
    for (const l of lines) {
      const near = nearestPointOnLine(l as Feature<LineString | MultiLineString>, point, {
        units: "meters",
      });
      const d = near.properties?.dist;
      if (typeof d === "number" && d < best) best = d;
    }
    return best;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Which district a point is in. Point-in-polygon first; when no polygon claims
 * the point we fall back to the nearest boundary, because the committed
 * district outlines are simplified one file at a time and neighbouring borders
 * therefore do not meet exactly. Without the fallback roughly one map centre in
 * seven hundred lands in a seam and the agent has to tell a user standing in
 * the middle of Taipei that it cannot say where they are. Overlaps are the same
 * defect from the other side: the first match wins, which at least is stable.
 */
export function findDistrict(
  features: readonly GlassMapFeature[],
  point: LngLat,
): string | null {
  let nearestName: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const feature of features) {
    if (feature?.properties?.category !== "district" || !feature.properties.name) continue;
    if (!feature.geometry) continue;
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
    try {
      if (booleanPointInPolygon(point, feature as Feature<Polygon | MultiPolygon>)) {
        return feature.properties.name;
      }
    } catch {
      continue;
    }
    const distance = boundaryDistanceM(feature, point);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestName = feature.properties.name;
    }
  }

  return nearestDistance <= DISTRICT_FALLBACK_MAX_M ? nearestName : null;
}

/**
 * Features (already sorted nearest first and already capped) split into compass
 * groups, groups ordered clockwise from north. A feature exactly at the origin
 * has no meaningful bearing; it is reported as north rather than dropped.
 */
export function groupByDirection(
  features: readonly GlassMapFeature[],
  origin: LngLat,
): SurroundingsGroup[] {
  const byDirection = new Map<Compass, SurroundingsItem[]>();

  for (const feature of features) {
    const center = featureCenter(feature);
    if (!center) continue;
    const p = feature.properties;
    const distance_m = distanceMeters(origin, center);
    const direction: Compass =
      distance_m === 0 ? "N" : compassFromBearing(turfBearing(origin, center));
    const item: SurroundingsItem = {
      name: p.name,
      ...(p.nameEn ? { name_en: p.nameEn } : {}),
      category: p.category,
      distance_m,
      ...(p.sample ? { sample: true as const } : {}),
    };
    const bucket = byDirection.get(direction);
    if (bucket) bucket.push(item);
    else byDirection.set(direction, [item]);
  }

  return COMPASS.filter((d) => byDirection.has(d)).map((direction) => ({
    direction,
    items: byDirection.get(direction) as SurroundingsItem[],
  }));
}
