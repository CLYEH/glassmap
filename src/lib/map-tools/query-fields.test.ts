/**
 * What `query` searches, and the promise that every tool searches the same
 * thing.
 *
 * Until T-102 a tool query read a place's local and English name and nothing
 * else, while the search box a person types into read five fields (name,
 * English name, brand, cuisine, address — `components/search-index-model.ts`).
 * That is a reverse-parity gap: the human could find the noodle place by its
 * street, or every coffee shop by `cuisine=coffee_shop`, and the agent asking
 * on their behalf could not — and could not see that it had failed, because a
 * search that finds nothing looks exactly like a city that has nothing.
 *
 * The fix is one predicate over five fields (`matchesQuery`), used by
 * `queryFeatures` and by the citywide index's disclosure alike. These tests
 * pin the two halves that make it worth trusting:
 *
 *  1. **each field really is searched**, one query per field, each chosen so
 *     that only that field can match — a test that matched on two fields at
 *     once would still pass if one of them were dropped tomorrow;
 *  2. **every tool that takes `query` widened together.** find_features,
 *     select_features and list_features_in_view share `queryFeatures`, so
 *     "the cafes matching X" is one set of features whichever tool was asked.
 *     The day one of them grew its own matcher, an agent could be told a place
 *     exists and then fail to select it.
 *
 * And the cost of the widening, pinned as well: the answer stays as lean as it
 * was (T-97), so a row that matched on an address does not start carrying one.
 */
import { describe, expect, it } from "vitest";
import { createMapTools } from "./index";
import { createMemoryToolStore } from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import type { FeatureOutput } from "./output";
import { matchesQuery, QUERY_FIELDS } from "./query";
import {
  createTier2Fetch,
  FIXTURE_FEATURES,
  TIER2_ENRICHED_FILES,
  TIER2_ENRICHED_INDEX,
  TIER2_FILES,
  TIER2_INDEX,
  VIEW,
  VIEW_BOUNDS,
} from "./test-fixtures";

const signal = new AbortController().signal;

interface ToolResult {
  [key: string]: unknown;
  error?: string;
  total?: number;
  features?: FeatureOutput[];
  selected?: FeatureOutput[];
}

const call = async (tool: GlassMapTool, input: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await tool.execute(input, { signal })) as ToolResult;

const idsOf = (features: FeatureOutput[] | undefined) => (features ?? []).map((f) => f.id);

function poiPage(files = TIER2_FILES, index: unknown = TIER2_INDEX) {
  const { fetchJson } = createTier2Fetch(files, index);
  const store = createMemoryToolStore({
    features: FIXTURE_FEATURES,
    bounds: VIEW_BOUNDS,
    view: VIEW,
    tier2FetchJson: fetchJson,
  });
  const tools = createMapTools(store);
  return { store, byName: Object.fromEntries(tools.map((t) => [t.name, t])) };
}

describe("the five fields a query reads", () => {
  /**
   * One row per field. Each query is chosen to be reachable through that field
   * and no other on the feature it finds — "dumpling" is nowhere in 鼎泰豐 or
   * "Din Tai Fung", "hotels" is nowhere in 台北W飯店 or "W Taipei" — so a test
   * that still passes after a field is deleted is impossible to write here.
   */
  const CASES: {
    field: (typeof QUERY_FIELDS)[number];
    query: string;
    category: string;
    id: string;
    files: Record<string, unknown>;
    index: unknown;
  }[] = [
    { field: "name", query: "小林", category: "cafe", id: "osm:node:102", files: TIER2_FILES, index: TIER2_INDEX },
    { field: "nameEn", query: "Xiaolin", category: "cafe", id: "osm:node:102", files: TIER2_FILES, index: TIER2_INDEX },
    {
      field: "brand",
      query: "hotels",
      category: "hotel",
      id: "osm:node:120",
      files: TIER2_ENRICHED_FILES,
      index: TIER2_ENRICHED_INDEX,
    },
    { field: "cuisine", query: "dumpling", category: "restaurant", id: "osm:node:110", files: TIER2_FILES, index: TIER2_INDEX },
    { field: "address", query: "羅斯福路", category: "cafe", id: "osm:node:100", files: TIER2_FILES, index: TIER2_INDEX },
  ];

  it.each(CASES)("finds a place by its $field alone", async ({ query, category, id, files, index }) => {
    const { byName } = poiPage(files, index);
    const out = await call(byName.find_features, { query, categories: [category] });

    expect(out.error).toBeUndefined();
    expect(idsOf(out.features)).toEqual([id]);
  });

  it("covers every field the citywide index carries, with nothing left untested", () => {
    // The index's five text columns and this list are the same list, and they
    // have to stay that way: a sixth column added to the index without a case
    // here would be a field the agent's search silently does not read.
    expect(CASES.map((c) => c.field)).toEqual([...QUERY_FIELDS]);
  });

  it("matches nothing when the needle is in no field at all", () => {
    // The predicate on its own, so "found nothing" is a decision and not an
    // accident of the fixture.
    const louisa = { name: "路易莎咖啡", nameEn: "Louisa Coffee", brand: "Louisa Coffee" };
    expect(matchesQuery(louisa, "louisa")).toBe(true);
    expect(matchesQuery(louisa, "starbucks")).toBe(false);
    // An absent field is absent, never an empty string that everything matches.
    expect(matchesQuery({}, "anything")).toBe(false);
  });
});

describe("one predicate, every tool that takes a query", () => {
  /**
   * 路易莎咖啡 (osm:node:100) sits inside the fixture viewport and carries the
   * address 106012臺北市大安區羅斯福路二段83之1號1樓. Nothing about its name
   * says 羅斯福路, so a tool that finds it here found it by address.
   */
  const BY_ADDRESS = "羅斯福路";

  it("finds, selects and lists the same address match", async () => {
    const { byName, store } = poiPage();
    // Naming the category is what loads it; the three tools then answer over
    // the same features in memory.
    const found = await call(byName.find_features, { query: BY_ADDRESS, categories: ["cafe"] });
    const selected = await call(byName.select_features, { query: BY_ADDRESS, categories: ["cafe"] });
    const listed = await call(byName.list_features_in_view, { query: BY_ADDRESS });

    expect(idsOf(found.features)).toEqual(["osm:node:100"]);
    expect(idsOf(selected.selected)).toEqual(["osm:node:100"]);
    expect(idsOf(listed.features)).toEqual(["osm:node:100"]);
    // Selected on the map, not merely reported: the agent can say "that one"
    // and the human sees it highlighted.
    expect(store.getSelection()).toEqual(["osm:node:100"]);
  });

  it("keeps the list answer exactly as lean as it was", async () => {
    // The T-97 law survives the widening. A match on an address must not talk
    // the list into carrying addresses: twenty rows of them is the answer's
    // budget spent on nineteen places nobody asked about. What the row does
    // carry is what it always carried - three tags - and the schema says so,
    // which is why QUERY_MATCHING names get_place_details.
    const { byName } = poiPage();
    const found = await call(byName.find_features, { query: BY_ADDRESS, categories: ["cafe"] });
    const [row] = found.features ?? [];

    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("address");
    expect(Object.keys(row)).toEqual([
      "id",
      "name",
      "category",
      "name_en",
      "brand",
      "opening_hours",
      "distance_m",
      "direction",
    ]);

    // The field it matched on is one call away, and only there.
    const details = (await call(byName.get_place_details, { id: "osm:node:100" })) as {
      address?: string;
    };
    expect(details.address).toContain(BY_ADDRESS);
  });

  it("says in the schema that a match can come from a field the list does not show", async () => {
    // Without this sentence the answer above is unexplainable from the outside:
    // an agent sees a row whose every visible field is unrelated to what it
    // searched for, and its only honest options are to distrust the tool or to
    // guess. One sentence in the schema is the whole fix.
    const { byName } = poiPage();
    for (const tool of ["find_features", "select_features", "list_features_in_view"]) {
      const schema = byName[tool].inputSchema as {
        properties: { query: { description: string } };
      };
      expect(schema.properties.query.description, tool).toMatch(
        /name, brand, cuisine, or address/,
      );
    }
    expect(
      (byName.find_features.inputSchema as { properties: { query: { description: string } } })
        .properties.query.description,
    ).toMatch(/get_place_details/);
  });
});
