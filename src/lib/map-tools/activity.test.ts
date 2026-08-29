/**
 * The activity feed is the page's only honest account of what the agent did.
 * A human watching the screen cannot read the JSON that goes back to the
 * model, so these tests are about trust: every call appears, in the order it
 * really happened, refusals included, described in words a person can check
 * against the map in front of them.
 */
import { describe, expect, it } from "vitest";
import { createMapTools } from "./index";
import { ACTIVITY_SUMMARY_TOOLS, withActivity } from "./activity";
import {
  ACTIVITY_LIMIT,
  createMemoryToolStore,
  type Drawing,
  type MemoryToolStore,
} from "@/lib/store/map-store";
import type { GlassMapFeature } from "@/lib/data/schema";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { FIXTURE_FEATURES, VIEW, VIEW_BOUNDS } from "./test-fixtures";

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
  const tools = createMapTools(store, { getBaseUrl: () => BASE_URL });
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
  { tool: "annotate", input: { at: "osm:node:2", note: "Client meeting here 3pm" } },
  { tool: "describe_surroundings", input: { from: "osm:node:2" } },
  { tool: "compare_areas", input: { a: "osm:node:2", b: "osm:node:1" } },
  { tool: "measure", input: { target: "drawing:1" } },
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
    expect(store.getActivity().filter((e) => e.readOnly)).toHaveLength(7);
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
  it("draw_shape names the shape, its size, its label and the id it created", async () => {
    // The mockup's row, verbatim: this is the line the feed was designed for.
    const { store, byName } = setup();
    await call(byName.draw_shape, {
      type: "circle",
      center: "osm:node:2",
      radius_m: 800,
      label: "10-min walk",
    });
    expect(last(store)).toMatchObject({
      tool: "draw_shape",
      summary: "Circle, 800 m — “10-min walk” → drawing:2",
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
    expect(last(store).summary).toMatch(/^Line, [\d,]+ m → drawing:2$/);
  });

  it("draw_shape reports the default radius the tool actually used", async () => {
    // The summary must describe what was drawn, not what was typed: a circle
    // with no radius_m is still an 800 m circle on the map.
    const { store, byName } = setup();
    await call(byName.draw_shape, { type: "circle", center: "osm:node:2" });
    expect(last(store).summary).toBe("Circle, 800 m → drawing:2");
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

  it("select_features counts the whole selection and calls an empty one a clear", async () => {
    const { store, byName } = setup();
    await call(byName.select_features, { categories: ["park"] });
    expect(last(store).summary).toBe("Highlighted 2 on the map");

    await call(byName.select_features, { ids: ["osm:way:10", "no:such:thing"] });
    expect(last(store).summary).toBe("Highlighted 1 on the map · 1 unknown id");

    await call(byName.select_features, { ids: [] });
    expect(last(store).summary).toBe("Cleared the selection");
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

  it("describe_surroundings says the district it found, in the data's own words", async () => {
    // OSM and human text in a summary is the point: "Around 大安區" is what
    // makes the row recognisable to the person looking at the map.
    const { store, byName } = setup();
    await call(byName.describe_surroundings, { from: "osm:node:2" });
    expect(last(store).summary).toMatch(/^Around 大安區 — \d+ features within 500 m$/);
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

  it("truncates the human text it echoes instead of letting one row run away", async () => {
    const { store, byName } = setup();
    await call(byName.annotate, { at: "osm:node:2", note: "x".repeat(200) });
    expect(last(store).summary).toBe(`Pinned “${"x".repeat(59)}…” → annotation:1`);
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
