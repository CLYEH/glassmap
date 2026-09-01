/**
 * The window between the page mounting and the six bundled datasets arriving.
 *
 * `useFeatureData` calls `setFeatures` only after `Promise.all` over ~614 KB of
 * GeoJSON resolves, so for the first moments of a page the store holds no
 * stations, no parks and no districts. A tool call made in that window can
 * still put a whole point-of-interest category in the store — naming a category
 * is what fetches it — and `resolveQueryInput` resolves `near` *after* that
 * fetch, deliberately, so that {near: "Fika Fika Cafe", categories: ["cafe"]}
 * can find its own origin.
 *
 * Those two facts together are the defect this file exists for: in the loading
 * window a place name is resolved against only the category the same call just
 * fetched. On the shipped data "Daan Station" then resolves to 臺北大安郵局 —
 * a post office 524 m away — and, being the only match, comes back as a
 * confident answer with no error and no candidates. The agent reads it as the
 * station and tells the human about the wrong building's opening hours.
 *
 * The rule these tests pin: a place name is never *silently* answered out of a
 * gazetteer that is missing the bundled data. It is answered when the base data
 * is there — including from a category fetched by the same call, which stays
 * deliberate — and refused with a retryable error when it is not.
 */
import { describe, expect, it } from "vitest";
import { createMapTools, POINT_STRING_FORM } from "./index";
import { createMemoryToolStore, type MemoryToolStoreInit } from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import {
  createRouteFetch,
  createTier2Fetch,
  FIXTURE_FEATURES,
  VIEW,
  VIEW_BOUNDS,
} from "./test-fixtures";
import { resetRouteThrottle } from "./route";

const signal = new AbortController().signal;

interface ToolResult {
  [key: string]: unknown;
  error?: string;
  origin?: { lng: number; lat: number };
  features?: { id: string }[];
}

const call = async (tool: GlassMapTool, input: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await tool.execute(input, { signal })) as ToolResult;

/**
 * A page whose POI files are reachable. `over` decides whether the bundled
 * datasets have landed: passing no `features` is the loading window itself.
 */
function page(over: MemoryToolStoreInit = {}) {
  const { fetchJson } = createTier2Fetch();
  const store = createMemoryToolStore({
    bounds: VIEW_BOUNDS,
    view: VIEW,
    tier2FetchJson: fetchJson,
    ...over,
  });
  // Injected, never networked: the suite is network-isolated, and plan_route
  // is the one tool that would otherwise reach the routing service.
  resetRouteThrottle();
  const tools = createMapTools(store, { routeFetch: createRouteFetch().routeFetch });
  return { store, byName: Object.fromEntries(tools.map((t) => [t.name, t])) };
}

/** The loading window: no bundled features yet, POI files reachable. */
const loading = (over: MemoryToolStoreInit = {}) => page(over);

/** The settled page the app spends its life in. */
const loaded = (over: MemoryToolStoreInit = {}) => page({ features: FIXTURE_FEATURES, ...over });

/**
 * The fixture's stand-in for 臺北大安郵局: a cafe named 大安 / "Daan Coffee",
 * which is what "Daan Station" resolves to when the station itself is not in
 * the store yet. Same shape as the real collision, same wrong answer.
 */
const DAAN_COFFEE = "osm:node:101";

describe("a place name during the base-data loading window", () => {
  it("does not answer 'Daan Station' out of the cafe file it just fetched", async () => {
    const { byName } = loading();
    const result = await call(byName.find_features, {
      near: "Daan Station",
      categories: ["cafe"],
    });

    // The defect, stated as the thing that must not happen: a confident origin
    // on a place the store has never seen. 大安 the cafe is a true fact about
    // Taipei and the wrong answer to "where is Daan Station".
    expect(result.origin).toBeUndefined();
    expect(result.features).toBeUndefined();
    expect(result.error).toBeTruthy();

    // The same call on a loaded page is what the wrong answer looked like:
    // 大安 the cafe, one confident match, distance 0 from an origin the store
    // had never seen. Asserted here so the fixture keeps proving it is a real
    // single-confident-match collision and not a name that never matched.
    const { byName: settled } = loaded();
    const good = await call(settled.find_features, { near: "Daan Coffee", categories: ["cafe"] });
    expect(good.origin).toEqual({ lng: 121.5425, lat: 25.0331 });
    expect((good.features ?? [])[0]?.id).toBe(DAAN_COFFEE);
  });

  it("says the data is still coming, not that the place does not exist", async () => {
    const { byName } = loading();
    const result = await call(byName.find_features, {
      near: "Daan Station",
      categories: ["cafe"],
    });

    // The whole point of a separate error. "unknown place" tells an agent the
    // place is not on this map, and a good agent then stops asking and
    // paraphrases what it does have. This wording tells it to ask again, which
    // is the one action that produces the right answer a moment later.
    expect(result.error).not.toBe("unknown place");
    expect(result.error).toMatch(/still loading/i);
    expect(result.error).toMatch(/again/i);
  });

  it("promises only the ids that actually work, because a base-data id does not", async () => {
    const { byName } = loading();
    // `resolveNear` looks an id up in the store before it consults the flag, so
    // during the window an id resolves only if the category holding it was
    // fetched this session. Every bundled id — a station, a district — takes
    // the same refusal a name does. An agent restoring a share link holds
    // exactly those ids, and advice it cannot act on turns a wait into what
    // looks like a loop.
    const base = await call(byName.find_features, { near: "osm:node:2", categories: ["cafe"] });
    expect(base.error).toMatch(/still loading/i);
    expect(base.origin).toBeUndefined();
    expect(base.error).not.toMatch(/a feature id or a/i);
    expect(base.error).toMatch(/coordinate always works/);
    expect(base.error).toMatch(/already given you/);
  });

  it("still resolves a feature id and a coordinate, which are not guesses", async () => {
    const { byName } = loading();

    // An id names one row; the fetched category really does contain it. There
    // is nothing missing base data could have contradicted, so refusing here
    // would cost the agent an answer it is entitled to.
    const byId = await call(byName.find_features, {
      near: DAAN_COFFEE,
      categories: ["cafe"],
      radius_m: 100,
    });
    expect(byId.error).toBeUndefined();
    expect(byId.origin).toEqual({ lng: 121.5425, lat: 25.0331 });

    const byPoint = await call(byName.find_features, {
      near: { lng: 121.5436, lat: 25.0334 },
      categories: ["cafe"],
    });
    expect(byPoint.error).toBeUndefined();
    expect(byPoint.origin).toEqual({ lng: 121.5436, lat: 25.0334 });
  });
});

describe("a place name once the base data is there", () => {
  it("resolves 'Daan Station' to the station, not to the cafe that shares the word", async () => {
    const { byName } = loaded();
    const result = await call(byName.find_features, {
      near: "Daan Station",
      categories: ["cafe"],
    });
    expect(result.error).toBeUndefined();
    expect(result.origin).toEqual({ lng: 121.5436, lat: 25.0334 });
  });

  /**
   * The behaviour the ordering at index.ts:454-465 exists for, and the reason
   * this fix cannot simply refuse to resolve names out of tier-2 data. The
   * origin here lives *only* in the cafe file, which this same call fetched.
   */
  it("still finds an origin that only exists in the category the same call fetched", async () => {
    const { store, byName } = loaded();
    expect(store.getLoadedCategories()).toEqual([]);

    const result = await call(byName.find_features, {
      near: "Louisa Coffee",
      categories: ["cafe"],
    });
    expect(result.error).toBeUndefined();
    expect(result.origin).toEqual({ lng: 121.5432, lat: 25.0338 });
    expect(store.getLoadedCategories()).toEqual(["cafe"]);
  });

  it("still says 'unknown place' for a name nothing on the map has", async () => {
    const { byName } = loaded();
    const result = await call(byName.find_features, { near: "Shibuya Crossing" });
    // A settled page that has looked and found nothing is a permanent answer,
    // and must not invite the retry that would never change it.
    expect(result.error).toBe("unknown place");
  });
});

/**
 * Every parameter in the tool layer that turns a human's words into a point,
 * with a call that exercises it. Found by reading the callers of `resolveNear`
 * and `resolvePlaceOne`, and then held to the schemas by the test below — the
 * list being hand-written is exactly why it cannot be trusted on its own.
 */
const NAME_TAKING_CALLS: [string, string, Record<string, unknown>][] = [
  ["find_features", "near", { near: "Daan Station" }],
  ["select_features", "near", { near: "Daan Station", categories: ["cafe"] }],
  ["set_map_view", "place", { place: "Daan Station" }],
  ["draw_shape", "center", { type: "circle", center: "Daan Station", radius_m: 300 }],
  ["plan_route", "from", { from: "Daan Station", to: { lng: 121.5432, lat: 25.0338 } }],
  ["plan_route", "to", { from: { lng: 121.5432, lat: 25.0338 }, to: "Daan Station" }],
  ["annotate", "at", { at: "Daan Station", note: "here" }],
  ["describe_surroundings", "from", { from: "Daan Station" }],
  ["compare_areas", "a", { a: "Daan Station", b: { lng: 121.5432, lat: 25.0338 } }],
  ["compare_areas", "b", { a: { lng: 121.5432, lat: 25.0338 }, b: "Daan Station" }],
];

/**
 * The `set_map_view` parameter that takes a name and nothing else, so it is not
 * built by `pointProperty` and the sweep below cannot find it by its schema.
 * Named here rather than left out: an exception someone has to delete on
 * purpose is a weaker hole than one nobody can see.
 */
const NAME_ONLY_PARAM = "set_map_view.place";

/**
 * Every location parameter the tools *declare*, read off the schemas.
 *
 * `pointProperty` builds all of them from one shared string form, so the
 * literal is a reliable marker for "this parameter accepts a place name". This
 * is what turns the list above from an inventory into an assertion: an
 * eleventh name-taking parameter added later is a row missing from
 * NAME_TAKING_CALLS, and this test goes red rather than staying green over an
 * unguarded tool. (It cannot catch a tool that hand-rolls its own location
 * schema instead of using the factory — that is what the exception above is
 * for, and it is one line to extend.)
 */
function declaredNameTakingParams(tools: GlassMapTool[]): string[] {
  const found: string[] = [];
  for (const tool of tools) {
    const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
    for (const [param, schema] of Object.entries(properties ?? {})) {
      const anyOf = (schema as { anyOf?: { description?: string }[] }).anyOf;
      if (anyOf?.[0]?.description === POINT_STRING_FORM) found.push(`${tool.name}.${param}`);
    }
  }
  return [...found, NAME_ONLY_PARAM].sort();
}

describe("the set of parameters that accept a place name", () => {
  it("is exactly the set the loading-window tests below exercise", () => {
    const { store } = loaded();
    const declared = declaredNameTakingParams(createMapTools(store));
    const covered = [...new Set(NAME_TAKING_CALLS.map(([tool, param]) => `${tool}.${param}`))].sort();
    // Both directions on purpose: a new parameter nobody covered fails here,
    // and so does a row for a parameter that no longer exists.
    expect(covered).toEqual(declared);
  });

  it("tells the model, in the schema, that a name can be too early", async () => {
    // The refusal is only half the contract. The other half is that the model
    // reads the schema before it calls, so "ask again" is a thing it already
    // knows rather than something it has to learn by failing.
    expect(POINT_STRING_FORM).toMatch(/map data not ready/);
    expect(POINT_STRING_FORM).toMatch(/asking again works/);
    const { byName } = loaded();
    const place = (
      byName.set_map_view.inputSchema as { properties: { place: { description: string } } }
    ).properties.place;
    expect(place.description).toMatch(/map data not ready/);
  });
});

describe.each(NAME_TAKING_CALLS)("%s.%s with a place name", (name, _param, input) => {
  it("refuses with the retryable error while the base data is loading", async () => {
    const { byName } = loading();
    const result = await call(byName[name], input);
    expect(result.error).toMatch(/still loading/i);
    expect(result.error).toMatch(/again/i);
  });

  it("answers once the base data is there", async () => {
    const { byName } = loaded();
    const result = await call(byName[name], input);
    expect(result.error).toBeUndefined();
  });
});

/**
 * What an answer says about the window it was asked in.
 *
 * The map has three things a call can be too early for, and two of them have
 * always been legible without asking: the camera as `bounds: null`, a share
 * link's categories as `tier2.loading`. Base data was the third, and the only
 * way to find it was to trip over a refusal — which meant every answer that
 * did not happen to resolve a name read as a settled, empty map.
 */
describe("what the answers say while the base data is loading", () => {
  it("get_map_state distinguishes an unfinished map from an empty one", async () => {
    const { byName } = loading();
    const state = await call(byName.get_map_state);
    // features_loaded: 0 is the same number an empty deployment reports, which
    // is why the number alone cannot carry this.
    expect(state.features_loaded).toBe(0);
    expect(state.base_data_loading).toBe(true);

    const settled = await call(loaded().byName.get_map_state);
    // Absent, not false: a settled page reports exactly the state it always
    // did, which is the rule tier2 disclosure already follows.
    expect(settled).not.toHaveProperty("base_data_loading");
  });

  it("says it on a write tool's state without the tool having to know", async () => {
    const { byName } = loading();
    const drawn = await call(byName.draw_shape, {
      type: "circle",
      center: { lng: 121.5436, lat: 25.0334 },
      radius_m: 300,
    });
    expect(drawn.error).toBeUndefined();
    expect((drawn.state as { base_data_loading?: true }).base_data_loading).toBe(true);
  });

  it.each(["find_features", "list_features_in_view", "describe_surroundings", "compare_areas"])(
    "%s carries it too, because a read-only answer returns no state",
    async (tool) => {
      const { byName } = loading();
      const input =
        tool === "compare_areas"
          ? { a: { lng: 121.5436, lat: 25.0334 }, b: { lng: 121.5432, lat: 25.0338 } }
          : {};
      const result = await call(byName[tool], input);
      expect(result.error).toBeUndefined();
      expect(result.base_data_loading).toBe(true);
    },
  );

  it("never claims it searched the bundled categories it does not have", async () => {
    const { byName } = loading();
    const result = await call(byName.find_features, {});

    // The failure this pins is worse than an empty result, and quieter. An
    // empty result invites a second look; `searched_categories: [mrt_station,
    // park, school, supermarket, listing, district]` is the tool vouching for
    // a search of six files that are not in the store, and it closes the
    // question. The disclosure beside it says why the list is empty.
    expect(result.searched_categories).toEqual([]);
    expect(result.base_data_loading).toBe(true);
    expect(result.total).toBe(0);
  });

  it("claims the bundled categories again the moment they are there", async () => {
    const { byName } = loaded();
    const result = await call(byName.find_features, {});
    // The narrowing is gated on the window and nothing else: on every settled
    // page — which is every page the app spends its life as — this field is
    // byte-for-byte what it was before T-103.
    expect(result.searched_categories).toEqual([
      "mrt_station",
      "park",
      "school",
      "supermarket",
      "listing",
      "district",
    ]);
    expect(result).not.toHaveProperty("base_data_loading");
  });
});
