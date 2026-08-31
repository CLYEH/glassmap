/**
 * get_place_details — the one place, in full.
 *
 * Every other read tool answers about *many* places and therefore answers
 * thinly: a name, a category, a distance. That is the right shape for choosing
 * between twenty cafes and the wrong shape for the question that follows it —
 * "can I call them, are they open, is the entrance step-free". This tool exists
 * for the second question, and these tests are about the three ways it could
 * answer it dishonestly:
 *
 *  - by inventing: a null, an empty string or a default where OpenStreetMap has
 *    nothing, which an agent reads back to a human as a fact about the place;
 *  - by judging: turning the `wheelchair` tag into an accessibility verdict this
 *    project does not make;
 *  - by spreading: letting these fields leak into the list answers, which is
 *    where the token budget for the whole shortlist lives.
 */
import { describe, expect, it } from "vitest";
import { createMapTools } from "./index";
import { createMemoryToolStore, type MemoryToolStoreInit } from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import type { FeatureOutput } from "./output";
import {
  createTier2Fetch,
  DAAN_FOREST_PARK,
  FIXTURE_FEATURES,
  TIER2_ENRICHED_FILES,
  TIER2_ENRICHED_INDEX,
  TIER2_FILES_WITH_BAKERY,
  TIER2_INDEX,
  USER_DRAWN_AREA,
  VIEW,
  VIEW_BOUNDS,
} from "./test-fixtures";

const signal = new AbortController().signal;

interface ToolResult {
  [key: string]: unknown;
  error?: string;
  id?: string;
  name?: string;
  name_en?: string;
  category?: string;
  categories?: string[];
  sample?: true;
  coordinate?: { lng: number; lat: number };
  features?: FeatureOutput[];
  annotation_id?: string;
}

/**
 * The Taipei fixture on a page whose POI files are the ones with
 * category-specific tags. Nothing is loaded until a call names a category, so
 * every test here loads what it is about first — the same order an agent works
 * in.
 */
function mapReady(
  files: Record<string, unknown> = TIER2_ENRICHED_FILES,
  index: unknown = TIER2_ENRICHED_INDEX,
  over: MemoryToolStoreInit = {},
) {
  const { fetchJson } = createTier2Fetch(files, index);
  const store = createMemoryToolStore({
    features: FIXTURE_FEATURES,
    bounds: VIEW_BOUNDS,
    view: VIEW,
    tier2FetchJson: fetchJson,
    drawings: [USER_DRAWN_AREA],
    ...over,
  });
  const byName = Object.fromEntries(createMapTools(store).map((t) => [t.name, t]));
  return { store, byName };
}

const call = async (tool: GlassMapTool, input: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await tool.execute(input, { signal })) as ToolResult;

describe("get_place_details", () => {
  it("answers one place with everything the page holds about it", async () => {
    // The whole point of the tool in one assertion: the agent has an id from a
    // search, and this is the call that turns it into an answer a human can act
    // on without anyone looking at the screen. Written out in full rather than
    // matched loosely, because a field that silently stops coming through is
    // indistinguishable from a place that never had it.
    const { byName } = mapReady();
    await call(byName.find_features, { categories: ["hotel"] });

    expect(await call(byName.get_place_details, { id: "osm:node:120" })).toEqual({
      id: "osm:node:120",
      name: "台北W飯店",
      name_en: "W Taipei",
      category: "hotel",
      coordinate: { lng: 121.56575, lat: 25.04049 },
      brand: "W Hotels",
      opening_hours: "24/7",
      address: "110臺北市信義區忠孝東路五段10號",
      phone: "+886 2 7703 8888",
      website: "http://www.wtaipei.com/",
      wheelchair: "yes",
      stars: "5",
    });
  });

  it("omits what OpenStreetMap does not have instead of answering null", async () => {
    /*
     * Citywide, `address` is on ~43% of tier-2 features and `phone` on ~22%
     * (public/data/README.md), so the sparse place is the common case, not the
     * edge one. The distinction this pins is what an agent says next: an absent
     * field means nobody has recorded a number, which is a reason to ring
     * ahead; a null or an empty string reads as "this hotel has no phone", and
     * the human stops looking.
     */
    const { byName } = mapReady();
    await call(byName.find_features, { categories: ["hotel"] });
    const out = await call(byName.get_place_details, { id: "osm:node:121" });

    expect(out).toEqual({
      id: "osm:node:121",
      name: "小客棧",
      name_en: "Little Inn",
      category: "hotel",
      coordinate: { lng: 121.5442, lat: 25.0349 },
    });
    expect("phone" in out).toBe(false);
    expect("wheelchair" in out).toBe(false);
    // Nothing empty travels either: an agent must not have to tell "" from
    // absent, and a JSON `null` is the same claim in another shape.
    expect(JSON.stringify(out)).not.toMatch(/null|""/);
  });

  it("carries the tags that belong to one kind of place", async () => {
    // Five of the 18 categories have a tag nobody else has (public/data/README.md,
    // "Enrichment fields (T-97)"). They are the answer to the question that
    // category is actually asked — "does it cost anything, will there be a
    // space" — so a details tool that only carried the common four would leave
    // the agent to guess exactly where guessing is worst.
    const { byName } = mapReady();
    await call(byName.find_features, { categories: ["parking"] });

    expect(await call(byName.get_place_details, { id: "osm:node:130" })).toMatchObject({
      category: "parking",
      fee: "yes",
      capacity: "120",
      wheelchair: "yes",
    });
  });

  it("names every category a double-tagged place is in", async () => {
    // 12 ids in the shipped extract are in two category files. Once both are
    // loaded the store keeps one feature under both names, and a place looked
    // up as a bakery still calls itself a restaurant — which the agent has to
    // be able to explain rather than sound confused by its own map.
    const { byName } = mapReady(TIER2_FILES_WITH_BAKERY, TIER2_INDEX);
    await call(byName.find_features, { categories: ["bakery", "restaurant"] });

    expect(await call(byName.get_place_details, { id: "osm:node:112" })).toMatchObject({
      id: "osm:node:112",
      name: "多那之",
      category: "bakery",
      categories: ["bakery", "restaurant"],
      cuisine: "bakery;coffee_shop",
    });
  });

  it("reports the wheelchair tag as OpenStreetMap has it, and does not re-judge it", async () => {
    /*
     * Two rules meet here. The vocabulary — yes, no, limited — is enforced once,
     * in `scripts/fetch-tier2.mjs`, and `src/lib/data/tier2.test.ts` holds the
     * shipped files to it. This layer reports what the file says, whatever it
     * says: a second filter here would be a rule that can drift from the first,
     * and it would quietly make this code the author of an accessibility
     * judgement rather than the messenger of a tag someone typed into OSM. The
     * tool's own description carries that distinction to the agent; the repo
     * claims no accessibility compliance anywhere, tool copy included.
     */
    const odd = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "osm:node:140", name: "Stepped Inn", category: "hotel", wheelchair: "no" },
          geometry: { type: "Point", coordinates: [121.54, 25.03] },
        },
        {
          // A value the generator drops today. If it ever stops dropping it,
          // this tool passes it on unchanged rather than deciding for itself
          // what "designated" means for the person asking.
          type: "Feature",
          properties: {
            id: "osm:node:141",
            name: "Designated Inn",
            category: "hotel",
            wheelchair: "designated",
          },
          geometry: { type: "Point", coordinates: [121.541, 25.031] },
        },
      ],
    };
    const { byName } = mapReady({ "/data/tier2/hotel.geojson": odd }, TIER2_ENRICHED_INDEX);
    await call(byName.find_features, { categories: ["hotel"] });

    expect(await call(byName.get_place_details, { id: "osm:node:140" })).toMatchObject({
      wheelchair: "no",
    });
    expect(await call(byName.get_place_details, { id: "osm:node:141" })).toMatchObject({
      wheelchair: "designated",
    });
  });

  it("answers about the map's own datasets too, from the centroid of an area", async () => {
    // The six bundled categories go through the same tool: an agent should not
    // have to know which of its ids came from a POI file. A park has no OSM
    // tags in this data and it is a polygon, so the honest answer is its
    // identity and one point — the centre the rest of the tool layer measures
    // from, to the same five decimals.
    const { byName } = mapReady();
    expect(await call(byName.get_place_details, { id: DAAN_FOREST_PARK.properties.id })).toEqual({
      id: "osm:way:10",
      name: "大安森林公園",
      name_en: "Da-an Forest Park",
      category: "park",
      coordinate: { lng: 121.53575, lat: 25.0295 },
    });
  });

  it("says when a place is fabricated demo data, exactly as the lists do", async () => {
    // The sample listings are invented (public/data/README.md). A details answer
    // that dropped the flag would be the one place in the tool layer where
    // fabricated data reads as a real address.
    const { byName } = mapReady();
    expect(await call(byName.get_place_details, { id: "listing:01" })).toMatchObject({
      id: "listing:01",
      category: "listing",
      sample: true,
    });
  });

  it("sends an unknown id back to find_features rather than answering nothing", async () => {
    // "No details" for an id that was mistyped, or whose category is not loaded,
    // would read as "this place has nothing recorded". Both are recoverable, and
    // the answer says how.
    const { byName } = mapReady();
    const out = await call(byName.get_place_details, { id: "osm:node:9999" });
    expect(out.error).toContain("osm:node:9999");
    expect(out.error).toMatch(/find_features/);
    // The recoverable half: an id from a share link whose category has not been
    // fetched yet is unknown for that reason and no other.
    expect(out.error).toMatch(/categor/);
    expect(out.id).toBeUndefined();
  });

  it("refuses a drawing or a note, and names the tool that does answer", async () => {
    // These ids are on the human's map and the agent can see them in map state,
    // so "unknown feature" would send it hunting for a typo. A shape has a size,
    // not an address; a note has words, not opening hours.
    const { byName } = mapReady();
    const drawing = await call(byName.get_place_details, { id: USER_DRAWN_AREA.id });
    expect(drawing.error).toMatch(/measure/);
    expect(drawing.error).toMatch(/get_map_state/);
    expect(drawing.error).toContain("drawing:1");

    const pinned = await call(byName.annotate, {
      at: "Daan Station",
      note: "Client meeting here 3pm",
    });
    const note = await call(byName.get_place_details, { id: pinned.annotation_id as string });
    expect(note.error).toMatch(/get_map_state/);
    expect(note.error).toContain("annotation:1");
  });

  it("asks for the one id it needs instead of guessing at the map", async () => {
    // No id could plausibly mean "the selection" or "the nearest place"; both
    // would be this tool answering a question nobody asked.
    const { byName } = mapReady();
    for (const input of [{}, { id: "   " }, { id: 42 }, { id: ["osm:node:120"] }]) {
      const out = await call(byName.get_place_details, input);
      expect(out.error, JSON.stringify(input)).toMatch(/^id is required/);
    }
  });

  it("keeps the list answers lean: the extra fields live here and nowhere else", async () => {
    /*
     * The rule this tool is the other half of (see `describeFeature`). A search
     * answers about up to 20 places at once and the agent is choosing between
     * them; carrying an address, a phone number, a website and a wheelchair tag
     * on every row multiplies the size of that answer for nineteen places
     * nobody asked about — and the search is the call that has to fit.
     *
     * This is the test that fails when someone helpfully widens the lists. If
     * that is ever the right call, it is a decision about every list output at
     * once, not a field quietly added to one.
     */
    const { byName } = mapReady();
    const found = await call(byName.find_features, { categories: ["hotel"], query: "W Taipei" });
    const listed = found.features?.[0] ?? ({} as FeatureOutput);

    expect(listed.id).toBe("osm:node:120");
    expect(Object.keys(listed).sort()).toEqual([
      "brand",
      "category",
      "direction",
      "distance_m",
      "id",
      "name",
      "name_en",
      "opening_hours",
    ]);

    // The same place, asked about by itself: everything the list left out.
    const details = await call(byName.get_place_details, { id: "osm:node:120" });
    for (const field of ["address", "phone", "website", "wheelchair", "stars"]) {
      expect(field in listed, `find_features must not carry ${field}`).toBe(false);
      expect(field in details, `get_place_details must carry ${field}`).toBe(true);
    }
  });
});
