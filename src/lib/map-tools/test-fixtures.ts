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
import type { Position } from "geojson";
import type { GlassMapFeature } from "@/lib/data/schema";
import type { Bounds, Drawing, LngLat, MapView } from "@/lib/store/map-store";
import { HttpStatusError, TIER2_INDEX_URL, type FetchJson } from "@/lib/store/tier2";
import type { RouteFetch } from "./route";

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

/**
 * A shape the *human* drew by hand. The tool layer must treat it exactly like
 * one of its own: this is the collaboration moment the demo is built on —
 * "I drew a circle, what supermarkets are in it?".
 * Covers DAAN_STATION and PX_MART_DAAN, and nothing else.
 */
export const USER_DRAWN_AREA: Drawing = {
  id: "drawing:1",
  source: "user",
  kind: "polygon",
  label: "my walk",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [121.54, 25.031],
        [121.546, 25.031],
        [121.546, 25.036],
        [121.54, 25.036],
        [121.54, 25.031],
      ],
    ],
  },
};

/** A hand-drawn route. It has no inside, so it can never answer "within". */
export const USER_DRAWN_LINE: Drawing = {
  id: "drawing:2",
  source: "user",
  kind: "line",
  geometry: {
    type: "LineString",
    coordinates: [
      [121.53, 25.03],
      [121.54, 25.03],
    ],
  },
};

/**
 * Two districts whose simplified outlines do not meet: there is a ~200 m gap
 * between lng 121.510 and 121.512, the same kind of seam the real
 * independently simplified district polygons have.
 */
export const WEST_DISTRICT = box(
  { id: "district:west", name: "西區", nameEn: "West District", category: "district", source: "sample" },
  [121.5, 25.0, 121.51, 25.01],
);

export const EAST_DISTRICT = box(
  { id: "district:east", name: "東區", nameEn: "East District", category: "district", source: "sample" },
  [121.512, 25.0, 121.52, 25.01],
);

/** In the seam: inside neither polygon, ~81 m from West and ~121 m from East. */
export const SEAM_POINT: LngLat = [121.5108, 25.005];

// ------------------------------------------------------------ routing fixture

/**
 * Fractions on purpose: the tool reports whole metres and whole seconds, so
 * these are the two numbers that prove it rounds rather than truncates
 * (3830.4 → 3830 down, 2760.6 → 2761 up).
 */
export const ROUTE_FIXTURE_DISTANCE = 3830.4;
export const ROUTE_FIXTURE_DURATION = 2760.6;

/**
 * A shape point at the precision OSRM really sends (7 decimals). Nothing but
 * round5 on the way into the store can turn it into [121.5322, 25.04123].
 */
export const ROUTE_FIXTURE_BEND: Position = [121.5321987, 25.0412345];

/** The service's answer for a route it found: OSRM's own envelope, verbatim. */
export function routeOkBody(
  coordinates: Position[],
  distance = ROUTE_FIXTURE_DISTANCE,
  duration = ROUTE_FIXTURE_DURATION,
) {
  return {
    code: "Ok",
    routes: [{ distance, duration, geometry: { type: "LineString", coordinates } }],
  };
}

/** The two coordinates a request asked for, read back out of its URL. */
export function routeRequestPoints(url: string): [Position, Position] {
  const path = url.split("?")[0];
  const pair = path.slice(path.lastIndexOf("/") + 1);
  const [from, to] = pair.split(";").map((p) => p.split(",").map(Number) as Position);
  return [from, to];
}

/**
 * A routing service with no network. The default answers every request with a
 * three-point line from where it was asked to where it was asked, so a test can
 * prove the request carried the points the tool resolved; `answer` replaces it
 * with a refusal, a malformed body, a huge line or a throw.
 *
 * `requests` is the log every rate-limit and "never called the service" test
 * asserts against.
 */
export function createRouteFetch(
  answer: (from: Position, to: Position) => unknown = (from, to) =>
    routeOkBody([from, ROUTE_FIXTURE_BEND, to]),
): { routeFetch: RouteFetch; requests: string[] } {
  const requests: string[] = [];
  const routeFetch: RouteFetch = async (url) => {
    requests.push(url);
    const [from, to] = routeRequestPoints(url);
    return answer(from, to);
  };
  return { routeFetch, requests };
}

// ------------------------------------------------------- tier-2 (POI) fixtures

/**
 * Point-of-interest files exactly as the generator writes them: `nameEn` like
 * the bundled datasets, no `source`, and absolute `file` paths in the index.
 * That format is owned by the data task, and this is the only place where the
 * two halves of the contract meet.
 */
function poi(
  id: string,
  name: string,
  nameEn: string,
  category: string,
  coordinates: [number, number],
  extra: Record<string, string> = {},
) {
  return {
    type: "Feature",
    properties: { id, name, nameEn, category, ...extra },
    geometry: { type: "Point", coordinates },
  };
}

/**
 * Three cafes, chosen for what they break rather than for realism:
 *  - one within the default 800 m walk of Daan Station, and inside VIEW_BOUNDS.
 *    It is also the *enriched* one: address, phone, website and wheelchair on
 *    top of the three list tags, copied in shape from a real Louisa row in
 *    public/data/tier2/cafe.geojson. A list answer about it still shows three
 *    tags and no more (T-97), so a fixture without them could not tell "the
 *    list stays lean" from "the store never had them";
 *  - one named 大安, exactly like DAAN_STATION — the measured citywide name
 *    collision. Once cafes are loaded, "大安" has to become a question rather
 *    than a guess;
 *  - one across town and outside the viewport, so "loaded city-wide" and "in
 *    view" can be told apart.
 */
export const TIER2_CAFE_COLLECTION = {
  type: "FeatureCollection",
  features: [
    poi("osm:node:100", "路易莎咖啡", "Louisa Coffee", "cafe", [121.5432, 25.0338], {
      brand: "Louisa Coffee",
      opening_hours: "Mo-Su 07:00-22:00",
      address: "106012臺北市大安區羅斯福路二段83之1號1樓",
      phone: "+886 2 2362 6229",
      website: "https://www.louisacoffee.co/",
      wheelchair: "limited",
    }),
    poi("osm:node:101", "大安", "Daan Coffee", "cafe", [121.5425, 25.0331]),
    poi("osm:node:102", "小林咖啡", "Xiaolin Coffee", "cafe", [121.512, 25.0505]),
  ],
};

export const TIER2_RESTAURANT_COLLECTION = {
  type: "FeatureCollection",
  features: [
    poi("osm:node:110", "鼎泰豐", "Din Tai Fung", "restaurant", [121.5361, 25.0331], {
      cuisine: "dumpling",
    }),
    poi("osm:node:111", "越南小吃", "Pho House", "restaurant", [121.544, 25.03], {
      cuisine: "vietnamese",
    }),
    // Also in the bakery file, under the same id: 12 ids in the real extract
    // appear in two category files, and both queries have to find them.
    poi("osm:node:112", "多那之", "Donutes", "restaurant", [121.5405, 25.0345], {
      cuisine: "bakery;coffee_shop",
    }),
  ],
};

/**
 * One shop, two files, one id — the double-tagging case, isolated. Byte-identical
 * to the restaurant file's copy apart from `category`, which is how all 12
 * dual-tagged ids look in the shipped extract.
 */
export const TIER2_BAKERY_COLLECTION = {
  type: "FeatureCollection",
  features: [
    poi("osm:node:112", "多那之", "Donutes", "bakery", [121.5405, 25.0345], {
      cuisine: "bakery;coffee_shop",
    }),
  ],
};

/**
 * The same shop, in a bakery file that disagrees with the restaurant file about
 * every other field.
 *
 * This is not hypothetical: `fetch-tier2.mjs --only=<category>` regenerates one
 * category without touching the others (public/data/README.md), so two files can
 * be exported weeks apart and an OSM edit in between - a rename, new opening
 * hours, a nudged centroid - lands in one of them only. The merged feature must
 * still be one fixed row rather than "whichever file the human's question
 * happened to fetch first".
 */
export const TIER2_BAKERY_COLLECTION_DRIFTED = {
  type: "FeatureCollection",
  features: [
    poi("osm:node:112", "多那之咖啡烘焙", "Donutes Coffee Bakery", "bakery", [121.5406, 25.0346], {
      cuisine: "bakery;coffee_shop;breakfast",
      opening_hours: "24/7",
    }),
  ],
};

/** More convenience stores than select_features will highlight in one call. */
export const TIER2_CONVENIENCE_COUNT = 600;

export const TIER2_CONVENIENCE_COLLECTION = {
  type: "FeatureCollection",
  features: Array.from({ length: TIER2_CONVENIENCE_COUNT }, (_, i) =>
    poi(`osm:node:${2000 + i}`, "7-ELEVEN", "7-Eleven", "convenience", [
      121.53 + (i % 25) * 0.0004,
      25.028 + Math.floor(i / 25) * 0.0004,
    ]),
  ),
};

/**
 * Two hotels, for the fields only a hotel has.
 *
 * Five of the 18 categories carry a tag the generator extracts for them alone —
 * `stars` here, `fee`/`capacity` for parking, `dispensing`, `religion` +
 * `denomination`, `emergency` (public/data/README.md, "Enrichment fields
 * (T-97)"). The pair is one richly tagged place and one that is barely more
 * than a name, because both are ordinary in OSM: citywide, `address` is on ~43%
 * of features and `phone` on ~22%, so an answer has to be as honest about the
 * second as it is complete about the first.
 *
 * Shapes and values follow real rows in public/data/tier2/hotel.geojson; the
 * ids are the fixture's own.
 */
export const TIER2_HOTEL_COLLECTION = {
  type: "FeatureCollection",
  features: [
    poi("osm:node:120", "台北W飯店", "W Taipei", "hotel", [121.56575, 25.04049], {
      brand: "W Hotels",
      opening_hours: "24/7",
      address: "110臺北市信義區忠孝東路五段10號",
      phone: "+886 2 7703 8888",
      website: "http://www.wtaipei.com/",
      wheelchair: "yes",
      stars: "5",
    }),
    // Named, located, and nothing else — the sparse case is not an edge case.
    poi("osm:node:121", "小客棧", "Little Inn", "hotel", [121.5442, 25.0349]),
  ],
};

/** One car park: `fee` and `capacity` belong to this category and no other. */
export const TIER2_PARKING_COLLECTION = {
  type: "FeatureCollection",
  features: [
    poi("osm:node:130", "台灣聯通停車場", "Taiwan Parking", "parking", [121.5434, 25.0331], {
      brand: "台灣聯通",
      address: "10844臺北市萬華區成都路81號",
      wheelchair: "yes",
      fee: "yes",
      capacity: "120",
    }),
  ],
};

/**
 * A page whose two loadable categories are the ones with category-only tags.
 * Kept apart from TIER2_INDEX rather than added to it: that index's four
 * categories are what the disclosure tests count, and "how many categories
 * exist" is an assertion in its own right.
 */
export const TIER2_ENRICHED_INDEX = {
  generated: "2026-08-31T00:00:00Z",
  attribution: "© OpenStreetMap contributors",
  categories: [
    {
      category: "hotel",
      count: TIER2_HOTEL_COLLECTION.features.length,
      file: "/data/tier2/hotel.geojson",
      bytes: 700,
    },
    {
      category: "parking",
      count: TIER2_PARKING_COLLECTION.features.length,
      file: "/data/tier2/parking.geojson",
      bytes: 400,
    },
  ],
};

export const TIER2_ENRICHED_FILES: Record<string, unknown> = {
  "/data/tier2/hotel.geojson": TIER2_HOTEL_COLLECTION,
  "/data/tier2/parking.geojson": TIER2_PARKING_COLLECTION,
};

/**
 * The index. `bakery` is listed but `TIER2_FILES` has no file for it: that is
 * the failure an agent has to be told about in words, not served as an empty
 * result. A test that wants the bakery to load adds
 * `TIER2_BAKERY_COLLECTION` to the files it passes in.
 */
export const TIER2_INDEX = {
  generated: "2026-08-30T00:00:00Z",
  attribution: "© OpenStreetMap contributors",
  categories: [
    {
      category: "cafe",
      count: TIER2_CAFE_COLLECTION.features.length,
      file: "/data/tier2/cafe.geojson",
      bytes: 512,
    },
    {
      category: "restaurant",
      count: TIER2_RESTAURANT_COLLECTION.features.length,
      file: "/data/tier2/restaurant.geojson",
      bytes: 384,
    },
    {
      category: "convenience",
      count: TIER2_CONVENIENCE_COUNT,
      file: "/data/tier2/convenience.geojson",
      bytes: 60000,
    },
    {
      category: "bakery",
      count: TIER2_BAKERY_COLLECTION.features.length,
      file: "/data/tier2/bakery.geojson",
      bytes: 300,
    },
  ],
};

export const TIER2_FILES: Record<string, unknown> = {
  "/data/tier2/cafe.geojson": TIER2_CAFE_COLLECTION,
  "/data/tier2/restaurant.geojson": TIER2_RESTAURANT_COLLECTION,
  "/data/tier2/convenience.geojson": TIER2_CONVENIENCE_COLLECTION,
};

/** The same server, plus the bakery file the index lists. */
export const TIER2_FILES_WITH_BAKERY: Record<string, unknown> = {
  ...TIER2_FILES,
  "/data/tier2/bakery.geojson": TIER2_BAKERY_COLLECTION,
};

/** The same server, with a bakery file that drifted away from the restaurant one. */
export const TIER2_FILES_WITH_DRIFTED_BAKERY: Record<string, unknown> = {
  ...TIER2_FILES,
  "/data/tier2/bakery.geojson": TIER2_BAKERY_COLLECTION_DRIFTED,
};

/**
 * A tier-2 server with no network: the manifest, the files it can serve, and a
 * log of every URL asked for — which is how a test proves a file was fetched
 * once, or never fetched at all.
 */
export function createTier2Fetch(
  files: Record<string, unknown> = TIER2_FILES,
  /** `null` serves a 404 for the index itself — a page whose data never shipped. */
  index: unknown = TIER2_INDEX,
): { fetchJson: FetchJson; requests: string[] } {
  const requests: string[] = [];
  // A missing file is a 404 with its status attached, exactly as httpFetchJson
  // reports one: the registry treats 4xx (permanent) and 5xx (a moment)
  // differently, so a fixture that threw a bare Error would exercise the wrong
  // branch of the code it is here to test.
  const fetchJson: FetchJson = async (url) => {
    requests.push(url);
    if (url === TIER2_INDEX_URL) {
      if (index === null) throw new HttpStatusError(404, `${url}: 404 Not Found`);
      return index;
    }
    if (!(url in files)) throw new HttpStatusError(404, `${url}: 404 Not Found`);
    return files[url];
  };
  return { fetchJson, requests };
}

/**
 * A tier-2 server whose file for one category answers 503 — the bad second, as
 * opposed to the 404 `createTier2Fetch` already serves for a file that was
 * never shipped.
 *
 * The two are not interchangeable anywhere the failure outlives the request: a
 * 404 says this deployment has no such file and a link may stop declaring the
 * category, while a 503 says only that this second went badly, and every reader
 * downstream of this page must still be told the category is part of the map.
 * `times` is how many requests fail before the file starts serving, so one call
 * can be a blip a retry gets past (`times: 1`) or an outage that outlives the
 * page (the default).
 */
export function createFlakyTier2Fetch(
  category: string,
  times = Number.POSITIVE_INFINITY,
): { fetchJson: FetchJson; requests: string[] } {
  const server = createTier2Fetch();
  const file = `/data/tier2/${category}.geojson`;
  let failed = 0;
  const fetchJson: FetchJson = async (url) => {
    if (url === file && failed < times) {
      failed += 1;
      server.requests.push(url);
      throw new HttpStatusError(503, `${url}: 503 Service Unavailable`);
    }
    return server.fetchJson(url);
  };
  return { fetchJson, requests: server.requests };
}

/**
 * The same server with its category files held open until `release()`.
 *
 * Everything share links promise about tier-2 is about the window between a
 * link being applied and its files arriving: the selection is made of ids
 * nothing can resolve yet, the address-bar mirror is about to run, and the
 * agent is already asking questions. A test that awaits the restore first is
 * standing after that window and cannot see anything that happens inside it.
 * The index is never gated, so the loader gets far enough to ask for a file.
 */
export function createGatedTier2Fetch(files?: Record<string, unknown>): {
  fetchJson: FetchJson;
  requests: string[];
  release: () => void;
} {
  const server = createTier2Fetch(files);
  const requests: string[] = [];
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const gated: FetchJson = async (url) => {
    // Logged where the request is issued rather than where it is served: what a
    // gated test asks is whether a second file was requested before the first
    // one came back, and the server only sees the ones that got through.
    requests.push(url);
    if (url !== TIER2_INDEX_URL) await gate;
    return server.fetchJson(url);
  };
  return { fetchJson: gated, requests, release: () => open() };
}
