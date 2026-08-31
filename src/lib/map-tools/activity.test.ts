/**
 * The activity feed is the page's only honest account of what the agent did.
 * A human watching the screen cannot read the JSON that goes back to the
 * model, so these tests are about trust: every call appears, in the order it
 * really happened, refusals included, described in words a person can check
 * against the map in front of them.
 */
import { describe, expect, it } from "vitest";
import { createMapTools } from "./index";
import { ACTIVITY_SUMMARY_TOOLS, describeCall, withActivity } from "./activity";
import {
  ACTIVITY_FX_HIT_LIMIT,
  ACTIVITY_LIMIT,
  createMemoryToolStore,
  type Drawing,
  type MemoryToolStore,
} from "@/lib/store/map-store";
import type { GlassMapFeature } from "@/lib/data/schema";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { resetRouteThrottle } from "./route";
import {
  createGatedTier2Fetch,
  createRouteFetch,
  createTier2Fetch,
  FIXTURE_FEATURES,
  TIER2_ENRICHED_FILES,
  TIER2_ENRICHED_INDEX,
  VIEW,
  VIEW_BOUNDS,
} from "./test-fixtures";

const signal = new AbortController().signal;
const BASE_URL = "https://glassmap.example/app";

/** A hand-drawn area big enough to hold both fixture parks. */
const WIDE_AREA: Drawing = {
  id: "drawing:1",
  source: "user",
  kind: "polygon",
  label: "the whole map",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [121.505, 25.015],
        [121.565, 25.015],
        [121.565, 25.055],
        [121.505, 25.055],
        [121.505, 25.015],
      ],
    ],
  },
};

function setup(over: Parameters<typeof createMemoryToolStore>[0] = {}) {
  const store = createMemoryToolStore({
    features: FIXTURE_FEATURES,
    bounds: VIEW_BOUNDS,
    view: VIEW,
    drawings: [WIDE_AREA],
    ...over,
  });
  // plan_route is the one tool that would otherwise reach the network, and its
  // rate limiter is module state shared by every tools instance: a suite that
  // did not clear it would be paced by FOSSGIS' one request per second.
  resetRouteThrottle();
  const tools = createMapTools(store, {
    getBaseUrl: () => BASE_URL,
    routeFetch: createRouteFetch().routeFetch,
  });
  return { store, tools, byName: Object.fromEntries(tools.map((t) => [t.name, t])) };
}

const call = (tool: GlassMapTool, input: Record<string, unknown> = {}) =>
  tool.execute(input, { signal }) as Promise<Record<string, unknown>>;

const last = (store: MemoryToolStore) => store.getActivity().at(-1)!;

const summaries = (store: MemoryToolStore) => store.getActivity().map((e) => e.summary);

/**
 * One call per tool that genuinely succeeds against the fixture, in a plausible
 * working order. Used as the reference sequence for order, flags and coverage.
 */
const HAPPY_CALLS: { tool: string; input: Record<string, unknown> }[] = [
  { tool: "get_map_state", input: {} },
  { tool: "set_map_view", input: { place: "Daan Station", zoom: 15 } },
  { tool: "list_features_in_view", input: { categories: ["park"] } },
  { tool: "find_features", input: { categories: ["park"], within: "drawing:1" } },
  { tool: "select_features", input: { categories: ["park"] } },
  {
    tool: "draw_shape",
    input: { type: "circle", center: "osm:node:2", radius_m: 800, label: "10-min walk" },
  },
  { tool: "plan_route", input: { from: "osm:node:2", to: "osm:node:1" } },
  { tool: "annotate", input: { at: "osm:node:2", note: "Client meeting here 3pm" } },
  // Its own note, taken off again: the one removal that is not a refusal — the
  // hand-drawn WIDE_AREA in this fixture is not the agent's to remove.
  { tool: "remove_from_map", input: { ids: ["annotation:1"] } },
  { tool: "describe_surroundings", input: { from: "osm:node:2" } },
  { tool: "compare_areas", input: { a: "osm:node:2", b: "osm:node:1" } },
  { tool: "measure", input: { target: "drawing:1" } },
  { tool: "get_place_details", input: { id: "osm:node:2" } },
  { tool: "get_share_link", input: {} },
];

async function runHappyPath() {
  const ctx = setup();
  for (const { tool, input } of HAPPY_CALLS) {
    const out = await call(ctx.byName[tool], input);
    // A summary written from a failed call would describe nothing; if the
    // fixture ever stops satisfying one of these, say so here rather than
    // silently asserting on "Refused - ...".
    expect({ tool, error: out.error }).toEqual({ tool, error: undefined });
  }
  return ctx;
}

describe("activity feed coverage", () => {
  it("records one entry per registered tool, in the order the calls completed", async () => {
    // Order is the feed's whole claim to being a record rather than a story:
    // the design mockup reordered its rows for the pitch and the product must
    // not (rationale-v5, "Feed-order truth").
    const { store } = await runHappyPath();
    expect(store.getActivity().map((e) => e.tool)).toEqual(HAPPY_CALLS.map((c) => c.tool));
    expect(store.getActivity().map((e) => e.seq)).toEqual(
      HAPPY_CALLS.map((_c, i) => i + 1),
    );
    expect(store.getActivity().every((e) => e.ok)).toBe(true);
  });

  it("covers every tool the app registers, so no tool can ship without feed copy", async () => {
    const { tools } = setup();
    expect([...ACTIVITY_SUMMARY_TOOLS].sort()).toEqual(tools.map((t) => t.name).sort());
    expect(HAPPY_CALLS.map((c) => c.tool).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("marks each entry read or write from the tool's own readOnlyHint", async () => {
    // The feed draws reads and writes differently; taking the flag from the
    // annotation is what keeps the dot on a row and the client's consent
    // prompt telling the same story.
    const { store, byName } = await runHappyPath();
    for (const entry of store.getActivity()) {
      expect({ tool: entry.tool, readOnly: entry.readOnly }).toEqual({
        tool: entry.tool,
        readOnly: byName[entry.tool].annotations?.readOnlyHint === true,
      });
    }
    expect(store.getActivity().filter((e) => e.readOnly)).toHaveLength(8);
  });

  it("writes one short line per call: no geometry, no URLs, no result dumps", async () => {
    const { store } = await runHappyPath();
    for (const summary of summaries(store)) {
      expect(summary.length).toBeLessThanOrEqual(120);
      expect(summary).not.toMatch(/https?:|[[{]/);
      expect(summary).not.toBe("");
    }
  });

  it("stamps each entry with the time the call finished", async () => {
    const before = Date.now();
    const { store, byName } = setup();
    await call(byName.get_map_state);
    const { at } = last(store);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});

describe("failed calls", () => {
  it("stay in the feed, in place, saying what was refused", async () => {
    // A refusal the human never sees looks like the agent doing nothing; the
    // row is how they learn to say "drawing:1", not "drawing:99".
    const { store, byName } = setup();
    await call(byName.find_features, { within: "drawing:99" });
    await call(byName.draw_shape, { type: "circle" });
    await call(byName.get_map_state);

    expect(store.getActivity().map((e) => [e.tool, e.ok])).toEqual([
      ["find_features", false],
      ["draw_shape", false],
      ["get_map_state", true],
    ]);
    expect(summaries(store)[0]).toBe("Refused — unknown drawing id: drawing:99");
    expect(summaries(store)[1]).toBe(
      "Refused — circle requires center: a coordinate, a feature id or a place name",
    );
    // The failed write really failed: the feed is not reporting a shape that
    // does not exist.
    expect(store.getDrawings()).toHaveLength(1);
  });

  it("cuts a long refusal down to one line", async () => {
    // Tool errors coach the agent at length; the row only has to tell the
    // human that this call was turned down and roughly why.
    const { store, byName } = setup();
    await call(byName.measure, { target: "osm:node:999" });
    expect(last(store).summary).toMatch(/^Refused — unknown target: .+…$/);
    expect(last(store).summary.length).toBeLessThanOrEqual(90);
  });

  it("keeps the refused row's read/write flag, so a failed write is not shown as a read", async () => {
    const { store, byName } = setup();
    await call(byName.annotate, { at: "osm:node:2" });
    expect(last(store)).toMatchObject({ tool: "annotate", ok: false, readOnly: false });
  });
});

describe("feed cap", () => {
  it(`keeps the newest ${ACTIVITY_LIMIT} and keeps counting seq past them`, async () => {
    // The feed is a live view, not a log. seq must not restart when the oldest
    // rows fall off: it is what the UI keys rows on and what tells a reader
    // this is call 55, not call 5.
    const { store, byName } = setup();
    const calls = ACTIVITY_LIMIT + 5;
    for (let i = 0; i < calls; i++) await call(byName.get_map_state);

    const activity = store.getActivity();
    expect(activity).toHaveLength(ACTIVITY_LIMIT);
    expect(activity[0].seq).toBe(calls - ACTIVITY_LIMIT + 1);
    expect(activity.at(-1)!.seq).toBe(calls);
  });
});

describe("summary copy", () => {
  it("draw_shape says it drew, then the shape, its size, its label and the id", async () => {
    // The design's row, verbatim (`mockup2-v5.html`: "Drew a circle, 800 m —
    // “10-min walk”" plus the id as a code chip). The verb is the whole point
    // of the re-voicing: a feed of noun phrases reads as an inventory of the
    // map, and this feed's claim is that an agent *did* something to it.
    const { store, byName } = setup();
    await call(byName.draw_shape, {
      type: "circle",
      center: "osm:node:2",
      radius_m: 800,
      label: "10-min walk",
    });
    expect(last(store)).toMatchObject({
      tool: "draw_shape",
      summary: "Drew a circle, 800 m — “10-min walk” → drawing:2",
      refIds: ["drawing:2"],
      readOnly: false,
      ok: true,
    });
  });

  it("draw_shape falls back to the shape's own measurement when there is no label", async () => {
    const { store, byName } = setup();
    await call(byName.draw_shape, {
      type: "line",
      coordinates: [
        [121.53, 25.03],
        [121.54, 25.03],
      ],
    });
    expect(last(store).summary).toMatch(/^Drew a line, [\d,]+ m → drawing:2$/);
  });

  it("draw_shape reports the default radius the tool actually used", async () => {
    // The summary must describe what was drawn, not what was typed: a circle
    // with no radius_m is still an 800 m circle on the map.
    const { store, byName } = setup();
    await call(byName.draw_shape, { type: "circle", center: "osm:node:2" });
    expect(last(store).summary).toBe("Drew a circle, 800 m → drawing:2");
  });

  it("plan_route says how far the walk is and what it called it", async () => {
    // The label is usually the tool's own, built from the two places it
    // resolved, so the row has to read it out of the answer: a human watching
    // sees the same words that are on the line drawn on their map. The
    // distance is the routing service's figure, which is what a person would
    // repeat out loud - not the length of the simplified line.
    const { store, byName } = setup();
    await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });
    expect(last(store)).toMatchObject({
      tool: "plan_route",
      summary: "Planned a walk, 3,830 m — “walk: 大安 → 台北車站” → drawing:2",
      refIds: ["drawing:2"],
      readOnly: false,
      ok: true,
    });
  });

  it("plan_route names the walk the caller named", async () => {
    const { store, byName } = setup();
    await call(byName.plan_route, {
      from: "osm:node:2",
      to: "osm:node:1",
      label: "morning commute",
    });
    expect(last(store).summary).toBe("Planned a walk, 3,830 m — “morning commute” → drawing:2");
  });

  it("find_features says what was asked for and how many matched", async () => {
    const { store, byName } = setup();
    await call(byName.find_features, { categories: ["park"], within: "drawing:1" });
    expect(last(store)).toMatchObject({
      summary: "Parks within drawing:1 — found 2",
      refIds: ["drawing:1"],
      readOnly: true,
    });
  });

  it("find_features counts every match, not the page it returned", async () => {
    // limit is an output cap; a row saying "found 1" when six matched would
    // make the agent look like it missed things.
    const { store, byName } = setup();
    const out = await call(byName.find_features, { limit: 1 });
    expect(out.returned).toBe(1);
    expect(last(store).summary).toBe(`Features — found ${out.total}`);
  });

  it("find_features echoes the place and the words the human used", async () => {
    const { store, byName } = setup();
    await call(byName.find_features, { query: "Pxmart", near: "Daan Station" });
    expect(last(store).summary).toBe("“Pxmart” near Daan Station — found 1");
  });

  it("set_map_view names where it flew and the zoom it landed on", async () => {
    const { store, byName } = setup();
    await call(byName.set_map_view, { place: "Daan Station", zoom: 15 });
    expect(last(store)).toMatchObject({ summary: "Flew to Daan Station · z15", readOnly: false });
  });

  it("set_map_view reports a bare camera move by where the camera ended up", async () => {
    const { store, byName } = setup();
    await call(byName.set_map_view, { center: { lng: 121.5436, lat: 25.0334 }, zoom: 16 });
    expect(last(store).summary).toBe("Camera at 25.0334, 121.5436 · z16");
  });

  it("set_map_view keeps the feature id it was given, so the row links to it", async () => {
    const { store, byName } = setup();
    await call(byName.set_map_view, { feature_id: "osm:node:2" });
    expect(last(store)).toMatchObject({
      summary: "Flew to osm:node:2 · z15",
      refIds: ["osm:node:2"],
    });
  });

  it("get_share_link reports the link's size and never the link itself", async () => {
    // The URL carries the whole map state; pasting it into a feed row would
    // fill the panel and tell a human nothing they can act on.
    const { store, byName } = setup();
    const out = await call(byName.get_share_link);
    const { summary } = last(store);
    expect(out.url).toContain(BASE_URL);
    expect(summary).not.toContain(out.url as string);
    expect(summary).not.toContain("http");
    expect(summary).toMatch(/^Built a share link — [\d,]+ bytes$/);
    expect(Number(summary.replace(/\D/g, ""))).toBe(out.bytes);
  });

  it("annotate quotes the note the human will read on the map", async () => {
    const { store, byName } = setup();
    await call(byName.annotate, { at: "osm:node:2", note: "Client meeting here 3pm" });
    expect(last(store)).toMatchObject({
      summary: "Pinned “Client meeting here 3pm” → annotation:1",
      refIds: ["annotation:1"],
    });
  });

  it("select_features says 'all' only when nothing was left out, and calls an empty one a clear", async () => {
    // "Highlighted all 42 on the map" is the design's row, and the word "all"
    // is a claim, not decoration: it says the map is now showing everything
    // the call asked for. The moment one id was rejected it stops being true,
    // and the row that reports the rejection must not also assert it.
    const { store, byName } = setup();
    await call(byName.select_features, { categories: ["park"] });
    expect(last(store).summary).toBe("Highlighted all 2 on the map");

    await call(byName.select_features, { ids: ["osm:way:10", "osm:way:11", "no:such:thing"] });
    // Two real parks + one bogus id: count > 1, so only the !unknown term of the
    // "all" gate suppresses the word here - the row that reports a rejection must
    // not also assert "all" (this line is the mutation kill for that term).
    expect(last(store).summary).toBe("Highlighted 2 on the map · 1 unknown id");

    await call(byName.select_features, { ids: [] });
    expect(last(store).summary).toBe("Cleared the selection");
  });

  it("select_features never says 'all' of one thing", async () => {
    // "Highlighted all 1 on the map" is not a sentence anyone writes.
    const { store, byName } = setup();
    await call(byName.select_features, { ids: ["osm:way:10"] });
    expect(last(store).summary).toBe("Highlighted 1 on the map");
  });

  it("select_features drops 'all' while a share link's features are still arriving", async () => {
    // The window this exists for: a link named two cafes and the cafe file has
    // not landed, so the ids are selected (they are not lost) but nothing is
    // drawn at them yet. The count is the selection's; "all ... on the map" of
    // it would be the feed claiming three beads a human can only see one of.
    const { fetchJson, release } = createGatedTier2Fetch();
    const { store, byName } = setup({ tier2FetchJson: fetchJson });
    const settled = store.restoreCategories(["cafe"]);
    expect(store.getPendingCategories()).toEqual(["cafe"]);

    const out = await call(byName.select_features, {
      ids: ["osm:node:100", "osm:node:101", "osm:way:10"],
    });
    expect(out.pending_ids).toEqual(["osm:node:100", "osm:node:101"]);
    expect(last(store).summary).toBe("Highlighted 3 on the map");

    release();
    await settled;
    // Once they arrive the same call earns the word.
    await call(byName.select_features, { ids: ["osm:node:100", "osm:node:101", "osm:way:10"] });
    expect(last(store).summary).toBe("Highlighted all 3 on the map");
  });

  it("get_map_state reads out the loaded count with thousands separated", async () => {
    // The number a human is asked to trust is the number they can read; this
    // also pins the grouping so it cannot depend on the runtime's ICU build.
    const features: GlassMapFeature[] = Array.from({ length: 2063 }, (_v, i) => ({
      type: "Feature",
      properties: { id: `osm:node:${i}`, name: `Point ${i}`, category: "park", source: "osm" },
      geometry: { type: "Point", coordinates: [121.5, 25.03] },
    }));
    const { store, byName } = setup({ features });
    await call(byName.get_map_state);
    expect(last(store).summary).toBe("Read the camera — 2,063 features loaded");
  });

  it("remove_from_map names the one mark it took off, so the human can check the gap", async () => {
    // The same row the card's own Remove would have earned: what left the map,
    // and the words that were on it. The id rides in refIds so the page can
    // play the removal where the shape used to be.
    const { store, byName } = setup();
    await call(byName.draw_shape, { type: "circle", center: "osm:node:2", label: "10-min walk" });
    await call(byName.remove_from_map, { ids: ["drawing:2"] });
    expect(last(store)).toMatchObject({
      tool: "remove_from_map",
      summary: "Removed drawing:2 — “10-min walk”",
      refIds: ["drawing:2"],
      readOnly: false,
      ok: true,
    });
  });

  it("remove_from_map counts several, and says what it could not take", async () => {
    const { store, byName } = setup();
    await call(byName.draw_shape, { type: "circle", center: "osm:node:2" });
    await call(byName.annotate, { at: "osm:node:2", note: "here" });
    await call(byName.remove_from_map, {
      ids: ["drawing:2", "annotation:1", "osm:node:404", "drawings:9"],
    });
    // A malformed mark id and an id nothing answers to are one fact to the
    // person watching: the agent named something this map does not have.
    expect(last(store).summary).toBe("Removed 2 marks · 2 unknown ids");
    expect(last(store).refIds).toEqual(["drawing:2", "annotation:1"]);
  });

  it("remove_from_map shows a refused removal as a call that happened, not as a refusal", async () => {
    // The row a human sees when the agent tries to remove their own shape: the
    // call succeeded, their shape stayed. A top-level error would print
    // "Refused — ..." and, in a mixed batch, hide the marks that really went.
    const { store, byName } = setup();
    await call(byName.remove_from_map, { ids: ["drawing:1"] });
    expect(last(store)).toMatchObject({
      tool: "remove_from_map",
      summary: "Removed nothing · 1 of yours kept",
      ok: true,
    });
    expect(store.getDrawings()).toHaveLength(1);
  });

  it("describe_surroundings names the place it was asked about, not the district around it", async () => {
    // The row and the map are read together: the page marks the origin this
    // call resolved to, so a row saying "Around 大安區" beside a mark sitting
    // on one station is the feed contradicting the screen. The district is a
    // true fact about the place and still the wrong answer to "where is this
    // row about?" when the caller named somewhere. What the row shows is the
    // name the tool resolved, not the romanisation that was typed: the map
    // labels that station in its own words, and the row must match the label.
    const { store, byName } = setup();
    await call(byName.describe_surroundings, { from: "Daan Station" });
    expect(last(store).summary).toMatch(/^Around 大安 — \d+ places within 500 m$/);
  });

  it("describe_surroundings turns an id into the name the tool resolved it to", async () => {
    // Agents pass ids around: from is usually "osm:node:2", not a name a
    // person typed. "Around osm:node:2" is a row a human cannot check against
    // the map at all, and the name is the tool's own answer — the same echo
    // compare_areas' row is written from.
    const { store, byName } = setup();
    await call(byName.describe_surroundings, { from: "osm:node:2" });
    expect(last(store).summary).toMatch(/^Around 大安 — \d+ places within 500 m$/);
  });

  it("describe_surroundings falls back to the district when the call named nowhere", async () => {
    // OSM and human text in a summary is the point: "Around 大安區" is what
    // makes the row recognisable to the person looking at the map, and a
    // coordinate or a bare view-centre call has no better word for where it is.
    const { store, byName } = setup();
    await call(byName.describe_surroundings, { from: { lng: 121.5436, lat: 25.0334 } });
    expect(last(store).summary).toMatch(/^Around 大安區 — \d+ places within 500 m$/);
    await call(byName.describe_surroundings, {});
    expect(last(store).summary).toMatch(/^Around 大安區 — \d+ places within 500 m$/);
  });

  it("describe_surroundings counts places, and inflects the count", async () => {
    // "places", not "features": the design's row (`mockup2-v5.html`: "Around
    // 大安森林公園 — 25 places within 500 m") says what the tool actually
    // counts — everything inside the radius except the district the point is
    // standing in, which is the answer's own separate field. And a feed that
    // says "1 places" beside a map with one dot on it reads as a broken map,
    // not as a rounding of English.
    const { store, byName } = setup();
    await call(byName.describe_surroundings, { from: "osm:node:2", radius_m: 20 });
    expect(last(store).summary).toBe("Around 大安 — 1 place within 20 m");
  });

  it("list_features_in_view names what is on screen and how many of it there is", async () => {
    // The one row a human can check without touching anything: what the panel
    // says is in view against what they can see in view.
    const { store, byName } = setup();
    await call(byName.list_features_in_view, { categories: ["park"] });
    expect(last(store)).toMatchObject({
      summary: "Parks in view — found 1",
      readOnly: true,
      ok: true,
    });
  });

  it("list_features_in_view quotes the words the search was narrowed by", async () => {
    // A row reading "Features in view — found 1" beside a screen full of them
    // is the feed hiding the filter: the human cannot tell a search that found
    // one thing from a map that has one thing on it. The words are quoted the
    // way find_features quotes them, because it is the same filter and a
    // person should not have to learn two notations for it.
    const { store, byName } = setup();
    await call(byName.list_features_in_view, { query: "Pxmart" });
    expect(last(store).summary).toBe("“Pxmart” in view — found 1");

    await call(byName.list_features_in_view, { query: "大安", categories: ["mrt_station"] });
    expect(last(store).summary).toBe("MRT stations matching “大安” in view — found 2");
  });

  it("list_features_in_view describes only the filter this tool has", async () => {
    // The subject is shared with find_features, which also knows `near` and
    // `within`. Neither is in this tool's schema, so a caller that smuggles one
    // in must not get a row claiming a circle nobody drew or a place the search
    // never measured from — the human would go looking for it on the map.
    const { store, byName } = setup();
    await call(byName.list_features_in_view, {
      query: "Pxmart",
      near: "Daan Station",
      within: "drawing:1",
    });
    expect(last(store).summary).toBe("“Pxmart” in view — found 1");
    expect(last(store).refIds).toBeUndefined();
  });

  it("compare_areas names both places as the tool resolved them, not as they were typed", async () => {
    const { store, byName } = setup();
    await call(byName.compare_areas, { a: "osm:node:2", b: "osm:node:1" });
    expect(last(store).summary).toBe("Compared 大安 with 台北車站 · 800 m");
  });

  it("measure keeps the id it measured and the size it reported", async () => {
    const { store, byName } = setup();
    const out = await call(byName.measure, { target: "drawing:1" });
    expect(last(store)).toMatchObject({ refIds: ["drawing:1"], readOnly: true });
    expect(last(store).summary).toMatch(/^Measured drawing:1 — [\d,]+ m²$/);
    expect(out.area_m2).toBeGreaterThan(0);
  });

  it("get_place_details names the place and how much the map had on it", async () => {
    // The row is for the human, so it says the place, not the id the agent
    // typed — and it counts what the answer really carried rather than implying
    // a full card. The zero case has to read as "nobody has tagged this place",
    // not as a failed call: the tool answered, and the map is simply thin here.
    const { fetchJson } = createTier2Fetch(TIER2_ENRICHED_FILES, TIER2_ENRICHED_INDEX);
    const { store, byName } = setup({ tier2FetchJson: fetchJson });
    await call(byName.find_features, { categories: ["hotel"] });

    await call(byName.get_place_details, { id: "osm:node:120" });
    expect(last(store)).toMatchObject({
      tool: "get_place_details",
      summary: "Looked up 台北W飯店 — 7 details",
      refIds: ["osm:node:120"],
      readOnly: true,
      ok: true,
    });

    await call(byName.get_place_details, { id: "osm:node:121" });
    expect(last(store).summary).toBe("Looked up 小客棧 — no details recorded");
  });

  it("truncates the human text it echoes instead of letting one row run away", async () => {
    const { store, byName } = setup();
    await call(byName.annotate, { at: "osm:node:2", note: "x".repeat(200) });
    expect(last(store).summary).toBe(`Pinned “${"x".repeat(59)}…” → annotation:1`);
  });
});

/**
 * `fx` is the feed's only non-text field: the geometry the page may draw for a
 * row. It exists so the human can see *where* a call happened, and it is only
 * trustworthy while three things hold — it is read from the answer the agent
 * got, it is absent whenever the answer did not state it, and it never travels
 * back to the agent. Each test below holds one of those.
 */
describe("fx geometry", () => {
  const fxOf = (store: MemoryToolStore) => last(store).fx;

  it("carries the point a search measured from, the radius it applied and the hits it returned", async () => {
    // "near Daan Station" is a name; only the tool knows the coordinate it
    // resolved to, and the page cannot mark a place it has to guess. The three
    // fields are exactly the three things the effect draws: a centre, a ring
    // and one mark per result.
    const { store, byName } = setup();
    const out = await call(byName.find_features, { near: "Daan Station", categories: ["supermarket"] });
    expect(fxOf(store)).toEqual({
      origin: [121.5436, 25.0334],
      radius_m: 800,
      hitIds: (out.features as { id: string }[]).map((f) => f.id),
    });
  });

  it("leaves out the radius when the search bounded nothing", async () => {
    // Drawing a ring around a search that had no radius would show the human a
    // limit the agent never applied — the row would claim a smaller answer
    // than the one that was given.
    const { store, byName } = setup();
    await call(byName.find_features, { query: "Pxmart" });
    expect(fxOf(store)).toEqual({
      origin: [VIEW.center[0], VIEW.center[1]],
      hitIds: ["osm:node:30", "osm:node:32"],
    });
  });

  it("still says where an empty search looked", async () => {
    // "Nothing here" is a fact about a place. The row keeps the origin so the
    // page can show which place was searched and came back empty.
    const { store, byName } = setup();
    await call(byName.find_features, { query: "Shibuya" });
    expect(fxOf(store)).toEqual({ origin: [VIEW.center[0], VIEW.center[1]] });
  });

  it(`caps hitIds at ${ACTIVITY_FX_HIT_LIMIT} without capping the answer`, async () => {
    // The cap is a drawing decision: past a few dozen marks the map is a
    // smear. It must never look like the search found fewer things, so the
    // answer the agent reads is untouched and the row still counts them all.
    const features: GlassMapFeature[] = Array.from({ length: 40 }, (_v, i) => ({
      type: "Feature",
      properties: { id: `osm:node:${i}`, name: `Point ${i}`, category: "park", source: "osm" },
      geometry: { type: "Point", coordinates: [121.5375 + i * 1e-4, 25.0325] },
    }));
    const { store, byName } = setup({ features, drawings: [] });
    const out = await call(byName.find_features, { limit: 40 });

    expect(out.returned).toBe(40);
    expect(last(store).summary).toBe("Features — found 40");
    expect(fxOf(store)?.hitIds).toHaveLength(ACTIVITY_FX_HIT_LIMIT);
    // The kept ids are the first of the page, so the marks are the nearest
    // results rather than an arbitrary slice of them.
    expect(fxOf(store)?.hitIds).toEqual(
      (out.features as { id: string }[]).slice(0, ACTIVITY_FX_HIT_LIMIT).map((f) => f.id),
    );
  });

  it("carries where the camera landed, however the caller asked for it", async () => {
    // A place name, an id and a coordinate all end at one point, and it is the
    // camera's own new centre — the state the tool returned, not the input.
    const { store, byName } = setup();
    await call(byName.set_map_view, { place: "Daan Station", zoom: 15 });
    expect(fxOf(store)).toEqual({ origin: [121.5436, 25.0334] });
    await call(byName.set_map_view, { center: { lng: 121.51, lat: 25.05 } });
    expect(fxOf(store)).toEqual({ origin: [121.51, 25.05] });
  });

  it("carries both ends of a planned walk, and no radius", async () => {
    // A route is between two places, and both of them are in the answer
    // because the tool resolved them - the caller may have named neither. The
    // radius stays out: nothing about a walk was measured in a circle, and the
    // page must not ring one.
    const { store, byName } = setup();
    await call(byName.plan_route, { from: "osm:node:2", to: "osm:node:1" });
    expect(fxOf(store)).toEqual({
      origin: [121.5436, 25.0334],
      originB: [121.517, 25.0478],
    });
  });

  it("carries both centres of a comparison and the radius they share", async () => {
    // The shared radius is what makes the two counts comparable; a page
    // drawing two different circles would be showing a comparison that was
    // never made.
    const { store, byName } = setup();
    await call(byName.compare_areas, { a: "osm:node:2", b: "osm:node:1", radius_m: 500 });
    expect(fxOf(store)).toEqual({
      origin: [121.5436, 25.0334],
      originB: [121.517, 25.0478],
      radius_m: 500,
    });
  });

  it("carries the point describe_surroundings swept and how far it swept", async () => {
    const { store, byName } = setup();
    await call(byName.describe_surroundings, { from: "osm:node:2" });
    expect(fxOf(store)).toEqual({ origin: [121.5436, 25.0334], radius_m: 500 });
    await call(byName.describe_surroundings, { from: "osm:node:2", radius_m: 250 });
    expect(fxOf(store)?.radius_m).toBe(250);
  });

  it("gives no fx to the calls whose geometry is already on the map", async () => {
    // A drawing, a pin and a measured shape are real objects the page can look
    // up by the id in refIds; echoing their coordinates into the feed would be
    // a second copy of the same truth, free to drift from the first.
    const { store } = await runHappyPath();
    const byTool = new Map(store.getActivity().map((e) => [e.tool, e]));
    for (const tool of ["draw_shape", "annotate", "measure", "select_features"]) {
      expect({ tool, fx: byTool.get(tool)?.fx }).toEqual({ tool, fx: undefined });
    }
    expect(byTool.get("draw_shape")?.refIds).toEqual(["drawing:2"]);
    expect(byTool.get("measure")?.refIds).toEqual(["drawing:1"]);
    // ...and none to the calls that are about no single place at all.
    for (const tool of ["get_map_state", "list_features_in_view", "get_share_link"]) {
      expect({ tool, fx: byTool.get(tool)?.fx }).toEqual({ tool, fx: undefined });
    }
  });

  it("never reaches the agent: it is on the row, not in the answer", async () => {
    // The feed is the page's own view of what happened. Adding a field to a
    // tool result would put it in the model's context, where it costs tokens
    // and says nothing the answer does not already say.
    const { store, byName } = setup();
    const found = await call(byName.find_features, { near: "Daan Station" });
    const state = await call(byName.get_map_state);
    expect(found).not.toHaveProperty("fx");
    expect(state).not.toHaveProperty("fx");
    expect(JSON.stringify(state)).not.toContain("fx");
    expect(fxOf(store)).toBeUndefined(); // ...the row above is get_map_state's.
    expect(store.getActivity().at(-2)?.fx).toBeDefined();
  });

  it("invents nothing when the answer has no geometry in it", async () => {
    // The page degrades to a row with no mark. It must never fall back to the
    // view centre or to the input's own words: a mark in the wrong place is a
    // lie about where the agent looked, and the human cannot check it.
    expect(describeCall("find_features", {}, { total: 0, returned: 0, features: [] }).fx).toBeUndefined();
    expect(describeCall("set_map_view", { place: "somewhere" }, { zoom: 15 }).fx).toBeUndefined();
    expect(describeCall("compare_areas", {}, { a: {}, b: {} }).fx).toBeUndefined();
    // A radius or a page of ids with no point to hang them on is not geometry:
    // the row would otherwise carry an fx the page could only place by guessing.
    expect(describeCall("describe_surroundings", { radius_m: 300 }, { total: 0 }).fx).toBeUndefined();
    expect(
      describeCall("find_features", {}, { total: 1, returned: 1, features: [{ id: "osm:node:2" }] }).fx,
    ).toBeUndefined();
    // A refusal is drawn as nothing at all, whatever it was asked to do.
    expect(describeCall("find_features", { near: "x" }, { error: "unknown place" }).fx).toBeUndefined();
  });
});

describe("the wrapper itself", () => {
  const stub = (execute: GlassMapTool["execute"]): GlassMapTool => ({
    name: "stub_tool",
    description: "stub",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute,
  });

  it("passes the tool's answer through untouched", async () => {
    // Observation only: the agent must get exactly what the tool returned,
    // with its untrustedContentHint and schema intact.
    const store = createMemoryToolStore();
    const answer = { url: "kept", nested: { ok: true } };
    const wrapped = withActivity(stub(() => answer), store);
    expect(await wrapped.execute({}, { signal })).toBe(answer);
    expect(wrapped.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(wrapped.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });

  it("records a tool that throws, then lets the throw through", async () => {
    // Tools are contracted not to throw. If one does, the human still watched
    // the agent make that call: a missing row is a worse lie than an ugly one.
    const store = createMemoryToolStore();
    const wrapped = withActivity(
      stub(() => {
        throw new Error("boom");
      }),
      store,
    );
    await expect(wrapped.execute({}, { signal })).rejects.toThrow("boom");
    expect(store.getActivity()).toHaveLength(1);
    expect(store.getActivity()[0]).toMatchObject({
      tool: "stub_tool",
      summary: "Failed — boom",
      ok: false,
      readOnly: true,
    });
  });

  it("still records a tool it has no copy for, as a bare call", async () => {
    const store = createMemoryToolStore();
    await withActivity(stub(() => ({ anything: 1 })), store).execute({}, { signal });
    expect(store.getActivity()[0].summary).toBe("Called stub_tool");
  });
});
