/**
 * A small slice of Taipei whose names are copied from the real dataset in
 * public/data, not invented.
 *
 * The awkward parts are the point:
 *  - the MRT station 大安森林公園 has exactly the same local name as the park
 *    it serves, so that lookup is genuinely ambiguous;
 *  - only 台北車站 carries a station suffix (108 other stations do not), so the
 *    suffix-stripping code has exactly one real customer;
 *  - OSM romanises the same syllable as "Da-an" and "Da'an" while humans type
 *    "Daan";
 *  - 208 supermarkets share the name 全聯福利中心 / "Pxmart".
 * Coordinates are approximate but their relationships are load-bearing, so
 * changing one will change several assertions on purpose.
 */
import type { GlassMapFeature } from "@/lib/data/schema";
import type { Bounds, MapView } from "@/lib/store/map-store";

type Props = GlassMapFeature["properties"];

function point(properties: Props, coordinates: [number, number]): GlassMapFeature {
  return { type: "Feature", properties, geometry: { type: "Point", coordinates } };
}

/** Axis-aligned rectangle from [west, south, east, north]; centroid is its middle. */
function box(properties: Props, [w, s, e, n]: Bounds): GlassMapFeature {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    },
  };
}

/** The only station in the real data whose name ends in a station suffix. */
export const TAIPEI_MAIN_STATION = point(
  {
    id: "osm:node:1",
    name: "台北車站",
    nameEn: "Taipei main station",
    category: "mrt_station",
    source: "osm",
  },
  [121.517, 25.0478],
);

export const DAAN_STATION = point(
  { id: "osm:node:2", name: "大安", nameEn: "Daan", category: "mrt_station", source: "osm" },
  [121.5436, 25.0334],
);

/** Same local name as DAAN_FOREST_PARK — the ambiguity is in the source data. */
export const DAAN_PARK_STATION = point(
  { id: "osm:node:3", name: "大安森林公園", nameEn: "Daan Park", category: "mrt_station", source: "osm" },
  [121.535, 25.033],
);

/** Centroid [121.53575, 25.0295]. */
export const DAAN_FOREST_PARK = box(
  { id: "osm:way:10", name: "大安森林公園", nameEn: "Da-an Forest Park", category: "park", source: "osm" },
  [121.533, 25.027, 121.5385, 25.032],
);

/** Centroid [121.5155, 25.0405]. */
export const PEACE_PARK = box(
  { id: "osm:way:11", name: "二二八和平公園", nameEn: "228 Peace Park", category: "park", source: "osm" },
  [121.5135, 25.039, 121.5175, 25.042],
);

/** Relations come out of the pipeline as points, like the real 建國中學. */
export const JIANGUO_HIGH_SCHOOL = point(
  {
    id: "osm:relation:20",
    name: "建國中學",
    nameEn: "Jianguo High School",
    category: "school",
    source: "osm",
  },
  [121.5115, 25.0325],
);

/** Two of the 208 branches that share a name; only distance tells them apart. */
export const PX_MART_DAAN = point(
  { id: "osm:node:30", name: "全聯福利中心", nameEn: "Pxmart", category: "supermarket", source: "osm" },
  [121.542, 25.034],
);

export const PX_MART_ZHONGZHENG = point(
  { id: "osm:node:32", name: "全聯福利中心", nameEn: "Pxmart", category: "supermarket", source: "osm" },
  [121.512, 25.05],
);

export const SAMPLE_LISTING = point(
  { id: "listing:01", name: "Sample listing 01", category: "listing", source: "sample", sample: true },
  [121.536, 25.031],
);

/** Centroid [121.544, 25.029]; only partly inside VIEW_BOUNDS. */
export const DAAN_DISTRICT = box(
  { id: "district:daan", name: "大安區", nameEn: "Da'an District", category: "district", source: "sample" },
  [121.528, 25.018, 121.56, 25.04],
);

export const FIXTURE_FEATURES: GlassMapFeature[] = [
  TAIPEI_MAIN_STATION,
  DAAN_STATION,
  DAAN_PARK_STATION,
  DAAN_FOREST_PARK,
  PEACE_PARK,
  JIANGUO_HIGH_SCHOOL,
  PX_MART_DAAN,
  PX_MART_ZHONGZHENG,
  SAMPLE_LISTING,
  DAAN_DISTRICT,
];

/** A viewport over Daan: excludes Taipei Main, Peace Park, the school and one PX Mart. */
export const VIEW_BOUNDS: Bounds = [121.525, 25.02, 121.55, 25.045];

export const VIEW: MapView = { center: [121.5375, 25.0325], zoom: 14, bearing: 0, pitch: 0 };

/** The six features whose bbox overlaps VIEW_BOUNDS, nearest to VIEW.center first. */
export const IN_VIEW_IDS_BY_DISTANCE = [
  "listing:01",
  "osm:node:3",
  "osm:way:10",
  "osm:node:30",
  "osm:node:2",
  "district:daan",
];

/** Geometry the loader could plausibly hand us; tools must degrade, not throw. */
export const BROKEN_FEATURES: GlassMapFeature[] = [
  {
    type: "Feature",
    properties: { id: "broken:null-geometry", name: "No geometry", category: "park", source: "osm" },
    geometry: null as unknown as GlassMapFeature["geometry"],
  },
  {
    type: "Feature",
    properties: { id: "broken:empty-polygon", name: "Empty polygon", category: "park", source: "osm" },
    geometry: { type: "Polygon", coordinates: [] },
  },
];
