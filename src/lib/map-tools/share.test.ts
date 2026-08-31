/**
 * Share links — the codec and the tool that hands one out.
 *
 * A share link is the only part of GlassMap that leaves the browser, and it
 * leaves it as text a human pastes into a chat window. Three things therefore
 * have to hold, and every test here is one of them:
 *
 *  1. What comes back is what went in. A link that restores the camera but
 *     loses the circle the human drew is worse than no link, because both
 *     sides believe they are looking at the same map.
 *  2. It survives being a URL. Chinese and emoji notes are the normal case in
 *     Taipei, not an edge case, and 8 KB is where links start being truncated
 *     by something in the middle.
 *  3. It is only data. A link is written by whoever sends it, so decoding must
 *     treat it as hostile: no unbounded text, no shape larger than draw_shape
 *     would accept, no claiming that the human drew something they did not.
 */
import type { LineString } from "geojson";
import { describe, expect, it } from "vitest";
import {
  decodeShareState,
  encodeShareState,
  MAX_SHARE_URL_BYTES,
  restoredAgentStateOf,
  restoredSelectionSources,
  selectionAttributionExplicit,
  SHARE_POLYLINE_THRESHOLD_BYTES,
  userSelectedIds,
  utf8Bytes,
  type ShareAnnotation,
  type ShareDrawing,
  type ShareState,
} from "./share";
import { encodePolyline } from "./polyline";
import { createMapTools } from "./index";
import {
  createMemoryToolStore,
  type MapView,
  type MemoryToolStore,
} from "@/lib/store/map-store";
import { round5, SELECTION_ID_LIMIT, type MapStateOutput } from "./state";
import { TIER2_CATEGORIES, type FetchJson } from "@/lib/store/tier2";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { circleGeometry, MAX_SHAPE_POINTS } from "./shapes";
import {
  createFlakyTier2Fetch,
  createGatedTier2Fetch,
  createTier2Fetch,
  FIXTURE_FEATURES,
  USER_DRAWN_AREA,
  USER_DRAWN_LINE,
  VIEW,
} from "./test-fixtures";

const signal = new AbortController().signal;

interface ShareResult {
  url?: string;
  bytes?: number;
  error?: string;
  omitted?: { drawings: number; annotations: number };
}

const BASE_URL = "https://glassmap.example/app";

function shareTool(over: Parameters<typeof createMemoryToolStore>[0] = {}, baseUrl = BASE_URL) {
  const store = createMemoryToolStore(over);
  const tools = createMapTools(store, { getBaseUrl: () => baseUrl });
  const tool = tools.find((t) => t.name === "get_share_link") as GlassMapTool;
  return { store, tool, call: async () => (await tool.execute({}, { signal })) as ShareResult };
}

/** A v1 hash built by hand, so a test can post payloads encodeShareState would never write. */
const wire = (payload: unknown) =>
  `v1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;

const decoded = (state: ShareState) => {
  const out = decodeShareState(encodeShareState(state));
  if ("error" in out) throw new Error(`expected a decodable link, got: ${out.error}`);
  return out;
};

const CIRCLE: ShareDrawing = {
  source: "agent",
  kind: "circle",
  label: "10-minute walk",
  center: [121.5436, 25.0334],
  radius_m: 800,
  geometry: circleGeometry([121.5436, 25.0334], 800),
};

/**
 * A traced path through Taipei: `points` points about 40 m apart, wandering the
 * way a hand-drawn outline or a planned route does rather than running straight.
 * Already rounded to 5 decimals, so a decoded copy can be compared for equality
 * against the original object.
 */
function routeOf(points: number): ShareDrawing {
  const coordinates: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    coordinates.push([
      round5(121.5 + i * 0.0004 + Math.sin(i / 7) * 0.0002),
      round5(25.03 + i * 0.0002 + Math.cos(i / 5) * 0.0002),
    ]);
  }
  return { source: "user", kind: "line", geometry: { type: "LineString", coordinates } };
}

/** The demo state: a camera, a handful of selected features, both sides' shapes and notes. */
const DEMO: ShareState = {
  view: VIEW,
  selection: ["osm:node:2", "osm:node:30", "osm:way:10", "listing:01"],
  drawings: [CIRCLE, USER_DRAWN_AREA, USER_DRAWN_LINE],
  annotations: [
    { source: "agent", at: [121.5436, 25.0334], note: "Nearest supermarket, 200 m", icon: "star" },
    { source: "user", at: [121.535, 25.033], note: "大安森林公園站 2 號出口 🚇", icon: "🚇" },
  ],
};

describe("share codec", () => {
  it("round-trips the whole demo map: camera, selection, both sides' shapes and notes", () => {
    const out = decoded(DEMO);
    expect(out.view).toEqual(VIEW);
    expect(out.selection).toEqual(DEMO.selection);
    expect(out.annotations).toEqual(DEMO.annotations);
    // Ids are not carried: the store on the other side assigns its own, so what
    // decode returns is exactly what addDrawing/addAnnotation take.
    expect(out.drawings).toEqual([
      CIRCLE,
      { source: "user", kind: "polygon", label: "my walk", geometry: USER_DRAWN_AREA.geometry },
      { source: "user", kind: "line", geometry: USER_DRAWN_LINE.geometry },
    ]);
    expect(out.drawings.some((d) => "id" in d)).toBe(false);
  });

  it("keeps who drew what, so a shared map still says which shapes the human made", () => {
    // The demo's whole point is that the agent and the human draw on one map;
    // a link that relabels the human's polygon as the agent's erases that.
    const out = decoded(DEMO);
    expect(out.drawings.map((d) => d.source)).toEqual(["agent", "user", "user"]);
    expect(out.annotations.map((a) => a.source)).toEqual(["agent", "user"]);
  });

  it("survives CJK and emoji, which are the normal case here and not an edge case", () => {
    const notes: ShareAnnotation[] = [
      { source: "user", at: [121.5, 25], note: "全聯福利中心（大安店）", icon: "🛒" },
      { source: "agent", at: [121.51, 25.01], note: "二二八和平公園 — 步行 5 分鐘 🚶‍♀️" },
    ];
    const out = decoded({ ...DEMO, annotations: notes });
    expect(out.annotations).toEqual(notes);
  });

  it("rounds coordinates to 5 decimals, so the link cannot disagree with what the agent said", () => {
    const view: MapView = { center: [121.123456789, 25.987654321], zoom: 14.3333333, bearing: 0, pitch: 0 };
    const out = decoded({ ...DEMO, view, drawings: [], annotations: [] });
    expect(out.view.center).toEqual([121.12346, 25.98765]);
    expect(out.view.zoom).toBe(14.33333);
  });

  it("re-encodes to exactly the same hash, so the UI can tell 'unchanged' from 'changed'", () => {
    // The UI writes the hash on every state change and reads it on load; if a
    // decode/encode cycle drifted, opening a link would rewrite the URL and
    // push a history entry for a map nobody moved.
    const first = encodeShareState(DEMO);
    expect(encodeShareState(decoded(DEMO))).toBe(first);
  });

  it("rebuilds a circle from centre and radius instead of carrying 65 points", () => {
    const circleOnly = encodeShareState({ ...DEMO, selection: [], drawings: [CIRCLE], annotations: [] });
    const ringOnly = encodeShareState({
      ...DEMO,
      selection: [],
      drawings: [{ source: "agent", kind: "polygon", geometry: CIRCLE.geometry }],
      annotations: [],
    });
    // Same shape on screen, an order of magnitude apart in a URL.
    expect(circleOnly.length).toBeLessThan(160);
    expect(ringOnly.length).toBeGreaterThan(1000);
    const out = decodeShareState(circleOnly);
    if ("error" in out) throw new Error(out.error);
    expect(out.drawings[0].geometry).toEqual(CIRCLE.geometry);
  });

  it("omits a zero bearing and pitch, and normalises a bearing that went round", () => {
    const flat = encodeShareState({ ...DEMO, drawings: [], annotations: [], selection: [] });
    const tilted = encodeShareState({
      ...DEMO,
      view: { ...VIEW, bearing: 385, pitch: 45 },
      drawings: [],
      annotations: [],
      selection: [],
    });
    expect(flat.length).toBeLessThan(tilted.length);
    const out = decodeShareState(tilted);
    if ("error" in out) throw new Error(out.error);
    expect(out.view).toMatchObject({ bearing: 25, pitch: 45 });
  });

  it("produces a payload any base64url reader can parse, not just this one", () => {
    // The hand-rolled encoder has to agree with the reference implementation,
    // or a link built in the browser would be unreadable everywhere else.
    const hash = encodeShareState(DEMO);
    const json = Buffer.from(hash.slice("v1.".length), "base64url").toString("utf8");
    expect(JSON.parse(json)).toMatchObject({ c: [121.5375, 25.0325], z: 14 });
  });

  it("keeps a demo-sized map well inside a pasteable link", () => {
    const bytes = utf8Bytes(encodeShareState(DEMO));
    // Measured at 687 bytes; the bound is what "fits in a chat message" means.
    expect(bytes).toBeLessThan(1024);
    expect(bytes).toBeLessThan(MAX_SHARE_URL_BYTES);
  });
});

describe("share codec: links written by someone else", () => {
  const HOSTILE: { name: string; hash: string }[] = [
    { name: "empty", hash: "" },
    { name: "just a hash sign", hash: "#" },
    { name: "no version prefix", hash: "eyJjIjpbMTIxLDI1XX0" },
    { name: "a future version", hash: "v9.eyJjIjpbMTIxLDI1XX0" },
    { name: "version only", hash: "v1." },
    { name: "not base64url", hash: "v1.@@@@" },
    { name: "truncated base64", hash: `${encodeShareState(DEMO).slice(0, 40)}` },
    { name: "base64 of not-JSON", hash: `v1.${Buffer.from("hello", "utf8").toString("base64url")}` },
    { name: "a JSON array", hash: wire([1, 2, 3]) },
    { name: "a JSON string", hash: wire("nope") },
    { name: "no camera", hash: wire({ z: 14, s: ["osm:node:2"] }) },
    { name: "camera off the planet", hash: wire({ c: [999, 999], z: 14 }) },
    { name: "zoom out of range", hash: wire({ c: [121.5, 25], z: 99 }) },
    { name: "a megabyte of text", hash: `v1.${"A".repeat(1_000_000)}` },
  ];

  it.each(HOSTILE)("returns an error string for $name, never a throw", ({ hash }) => {
    const out = decodeShareState(hash);
    expect(out, hash.slice(0, 24)).toHaveProperty("error");
    expect(typeof (out as { error: string }).error).toBe("string");
  });

  it("ignores keys it does not know, so a newer build's link still opens here", () => {
    const out = decodeShareState(
      wire({ c: [121.5, 25], z: 14, layers: ["satellite"], future: { x: 1 }, s: ["osm:node:2"] }),
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.view.center).toEqual([121.5, 25]);
    expect(out.selection).toEqual(["osm:node:2"]);
  });

  it("drops the items it cannot rebuild and keeps the rest of the map", () => {
    // One corrupt shape in a hand-edited link must not cost the other shapes,
    // the notes and the camera.
    const out = decodeShareState(
      wire({
        c: [121.5, 25],
        z: 14,
        d: [
          { k: "polygon", o: "user", g: [121.5, 25, 121.6] }, // odd number of numbers
          { k: "line", o: "agent", g: [121.5, 25, 121.6, 25.1] },
          { k: "square", o: "agent", g: [121.5, 25, 121.6, 25.1] }, // not a kind we draw
          { k: "circle", o: "agent", c: [121.5, 25], r: 500_000 }, // wider than the city
        ],
        a: [
          { o: "agent", p: [121.5, 25], n: "kept" },
          { o: "agent", p: ["x", "y"], n: "no location" },
          { o: "agent", p: [121.5, 25], n: "   " },
        ],
      }),
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.drawings.map((d) => d.kind)).toEqual(["line"]);
    expect(out.annotations.map((a) => a.note)).toEqual(["kept"]);
  });

  it("refuses a shape bigger than draw_shape would accept", () => {
    // Otherwise a link is a way around every limit the tool layer enforces:
    // one paste and the human's map renders a million points per frame.
    const tooMany = Array.from({ length: (MAX_SHAPE_POINTS + 1) * 2 }, (_, i) =>
      i % 2 ? 25 + i / 1e6 : 121.5 + i / 1e6,
    );
    const out = decodeShareState(wire({ c: [121.5, 25], z: 14, d: [{ k: "line", o: "user", g: tooMany }] }));
    if ("error" in out) throw new Error(out.error);
    expect(out.drawings).toEqual([]);
  });

  it("clips over-long text to the tools' own limits without splitting an emoji", () => {
    const out = decodeShareState(
      wire({
        c: [121.5, 25],
        z: 14,
        a: [{ o: "user", p: [121.5, 25], n: `${"a".repeat(499)}😀${"b".repeat(9000)}`, i: "🚇".repeat(50) }],
      }),
    );
    if ("error" in out) throw new Error(out.error);
    const note = out.annotations[0].note;
    expect(note.length).toBe(499);
    expect(note.endsWith("a")).toBe(true);
    // A lone surrogate is a replacement box on the map and invalid in a URL.
    expect(/[\uD800-\uDFFF]/.test(note)).toBe(false);
    expect(out.annotations[0].icon!.length).toBeLessThanOrEqual(24);
  });

  it("never lets a link claim the human drew something", () => {
    // "user" means someone in this room drew it by hand. A stranger's link
    // saying otherwise would make the agent talk about a shape nobody drew.
    const out = decodeShareState(
      wire({
        c: [121.5, 25],
        z: 14,
        d: [{ k: "line", o: "human-operator", g: [121.5, 25, 121.6, 25.1] }],
        a: [{ o: 7, p: [121.5, 25], n: "n" }],
      }),
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.drawings[0].source).toBe("agent");
    expect(out.annotations[0].source).toBe("agent");
  });
});

describe("get_share_link", () => {
  it("is read-only and takes no input, because there is nothing to ask for", async () => {
    const { tool } = shareTool();
    expect(tool.annotations?.readOnlyHint).toBe(true);
    // The URL is built here out of base64; unlike every other tool it echoes no
    // OSM or human text back to the client, so it carries no untrusted hint.
    expect(tool.annotations?.untrustedContentHint).toBeFalsy();
    expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("returns a URL that reproduces the map the store currently holds", async () => {
    const { call } = shareTool({
      view: VIEW,
      selection: ["osm:node:2"],
      drawings: [USER_DRAWN_AREA],
      annotations: [{ id: "annotation:1", source: "agent", at: [121.54, 25.03], note: "here" }],
    });
    const out = await call();
    expect(out.error).toBeUndefined();
    expect(out.url!.startsWith(`${BASE_URL}#v1.`)).toBe(true);
    expect(out.bytes).toBe(utf8Bytes(out.url!));

    const restored = decodeShareState(out.url!.slice(out.url!.indexOf("#")));
    if ("error" in restored) throw new Error(restored.error);
    expect(restored.view).toEqual(VIEW);
    expect(restored.selection).toEqual(["osm:node:2"]);
    expect(restored.drawings).toEqual([
      { source: "user", kind: "polygon", label: "my walk", geometry: USER_DRAWN_AREA.geometry },
    ]);
    expect(restored.annotations).toEqual([{ source: "agent", at: [121.54, 25.03], note: "here" }]);
  });

  it("reports what the link lost when the store holds a shape it cannot carry", async () => {
    // The UI owns hand-drawing; if it ever stores geometry this codec has no
    // form for, the human must be told the link is incomplete rather than
    // discover it in someone else's browser.
    const { call } = shareTool({
      drawings: [
        { id: "drawing:1", source: "user", kind: "polygon", geometry: { type: "Point", coordinates: [121.5, 25] } },
      ],
    });
    const out = await call();
    expect(out.url).toBeTruthy();
    expect(out.omitted).toEqual({ drawings: 1, annotations: 0 });
  });

  it("says nothing was lost when nothing was", async () => {
    const { call } = shareTool({ drawings: [USER_DRAWN_AREA, USER_DRAWN_LINE] });
    expect((await call()).omitted).toBeUndefined();
  });

  it("hands out a link for a map the old wire could not carry at all", async () => {
    // The point of v3, through the tool that promises the link: a 500-point
    // route is a legal draw_shape call and used to cost more than the whole
    // budget in JSON numbers (measured below, "a drawing too big to write as
    // numbers"). `omitted` is the assertion that matters most - it comes from
    // get_share_link reading its own link back, so an encoding that lost the
    // shape would report it here rather than in someone else's browser.
    const line = routeOf(MAX_SHAPE_POINTS);
    const { call } = shareTool({ drawings: [{ id: "drawing:1", ...line }] });
    const out = await call();
    expect(out.error).toBeUndefined();
    expect(out.url).toContain("#v3.");
    expect(out.bytes!).toBeLessThan(MAX_SHARE_URL_BYTES);
    expect(out.omitted).toBeUndefined();

    const restored = decodeShareState(out.url!.slice(out.url!.indexOf("#")));
    if ("error" in restored) throw new Error(restored.error);
    expect(restored.drawings).toEqual([line]);
  });

  it("refuses to hand out a link too long to survive being pasted", async () => {
    // Still a real state after v3, and not a hypothetical one: draw_shape caps
    // the points in one shape, nothing caps how many shapes a map holds, and
    // delta-encoding buys a factor of about five rather than infinity. Eight
    // traced outlines and the answer has to say which part to remove instead
    // of returning a link that arrives truncated.
    const outline = (n: number): ShareDrawing => {
      const ring = Array.from({ length: MAX_SHAPE_POINTS }, (_, i) => [
        121.5 + n / 50 + Math.cos((i / MAX_SHAPE_POINTS) * 2 * Math.PI) / 100,
        25 + Math.sin((i / MAX_SHAPE_POINTS) * 2 * Math.PI) / 100,
      ]);
      return {
        source: "user",
        kind: "polygon",
        geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
      };
    };
    const { call } = shareTool({
      drawings: Array.from({ length: 8 }, (_, n) => ({ id: `drawing:${n}`, ...outline(n) })),
    });
    const out = await call();
    expect(out.url).toBeUndefined();
    expect(out.error).toMatch(/drawing/i);
    expect(out.bytes!).toBeGreaterThan(MAX_SHARE_URL_BYTES);
  });

  it("tells the agent which shapes it can remove itself and which need the human", async () => {
    /*
     * The advice has to be actionable by whoever reads it. remove_from_map
     * refuses a hand-drawn shape on purpose, so "remove one of the 2 drawings"
     * over two of the human's outlines would send the agent into a refusal loop
     * instead of to the one person who can press Remove.
     *
     * Eight traced outlines per case, not one: the v3 wire fits a single
     * 500-point ring in a link, so overflowing honestly now takes a pile — and
     * the 7+1 mixes are what let both singular forms ("the one drawing you
     * made", "their one") be exercised with the drawings genuinely at fault.
     */
    const outline = (n: number, source: "agent" | "user"): ShareDrawing & { id: string } => {
      const ring = Array.from({ length: MAX_SHAPE_POINTS }, (_, i) => [
        121.5 + n / 50 + Math.cos((i / MAX_SHAPE_POINTS) * 2 * Math.PI) / 100,
        25 + Math.sin((i / MAX_SHAPE_POINTS) * 2 * Math.PI) / 100,
      ]);
      return {
        id: `drawing:${n + 1}`,
        source,
        kind: "polygon",
        geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
      };
    };
    const pile = (mineCount: number, total = 8) =>
      Array.from({ length: total }, (_, n) => outline(n, n < mineCount ? "agent" : "user"));

    const mine = await shareTool({ drawings: pile(8) }).call();
    expect(mine.error).toContain("remove one of the 8 drawings you made with remove_from_map");
    expect(mine.error).not.toMatch(/press Remove/);

    const theirs = await shareTool({ drawings: pile(0) }).call();
    expect(theirs.error).toMatch(
      /all 8 drawings were drawn by hand, so ask the human to tap one on the map and press Remove/,
    );
    expect(theirs.error).not.toContain("remove_from_map");

    const oneMine = await shareTool({ drawings: pile(1) }).call();
    expect(oneMine.error).toContain("remove the one drawing you made with remove_from_map");
    expect(oneMine.error).toContain("one of their 7 and press Remove");

    // ...and the singular side reads as English too: "one of the 1 drawings"
    // is the sentence an agent has to act on, and it reads as a bug in the map.
    const oneTheirs = await shareTool({ drawings: pile(7) }).call();
    expect(oneTheirs.error).toContain("remove one of the 7 drawings you made");
    expect(oneTheirs.error).toContain("tap their one and press Remove");

    expect(
      `${mine.error} ${theirs.error} ${oneMine.error} ${oneTheirs.error}`,
    ).not.toMatch(/ 1 drawings/);
  });

  it("blames the selection, not the shapes, when the selection is what overflowed", async () => {
    // select_features has no cap: "every supermarket in Taipei" is 208 ids. An
    // agent told to remove drawings there would delete the human's shapes and
    // still not get a link.
    const { call } = shareTool({
      selection: Array.from({ length: 500 }, (_, i) => `osm:node:${100000 + i}`),
    });
    const out = await call();
    expect(out.url).toBeUndefined();
    expect(out.error).toMatch(/selection/i);
    expect(out.error).not.toMatch(/drawing/i);
  });

  it("errors instead of returning a hash with no page in front of it", async () => {
    // Under SSR or in a unit test there is no location; "#v1.…" on its own is
    // not something a human can paste anywhere.
    const { call } = shareTool({}, "");
    const out = await call();
    expect(out.url).toBeUndefined();
    expect(out.error).toBeTruthy();
  });

  it("reads the page URL itself when the caller injects nothing", async () => {
    // This is the path the app actually uses: createMapTools(store) in the
    // browser. Nothing may be imported from window at module load.
    const original = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", {
      value: { origin: "https://glassmap.example", pathname: "/", search: "?shim=1", hash: "#v1.stale" },
      configurable: true,
    });
    try {
      const store = createMemoryToolStore({ view: VIEW });
      const tool = createMapTools(store).find((t) => t.name === "get_share_link")!;
      const out = (await tool.execute({}, { signal })) as ShareResult;
      // Origin and path only: one "#", and no stale hash carried over.
      expect(out.url!.startsWith("https://glassmap.example/#v1.")).toBe(true);
      expect(out.url!.split("#")).toHaveLength(2);
    } finally {
      if (original) Object.defineProperty(globalThis, "location", original);
      else delete (globalThis as { location?: unknown }).location;
    }
  });

  it("keeps working when the injected base URL already has a hash on it", async () => {
    const { call } = shareTool({ view: VIEW }, `${BASE_URL}#v1.old`);
    const out = await call();
    expect(out.url!.split("#")).toHaveLength(2);
    expect(out.url!.startsWith(`${BASE_URL}#v1.`)).toBe(true);
  });
});

/**
 * A link produced by the build before tier-2 categories existed, pasted here
 * verbatim: it is the DEMO map above, and it is what every link anyone has
 * already sent looks like. Both halves of the wire contract are pinned to it —
 * a map with no categories must still encode to exactly these bytes, and these
 * bytes must still open.
 */
const V1_DEMO_LINK =
  "v1.eyJjIjpbMTIxLjUzNzUsMjUuMDMyNV0sInoiOjE0LCJzIjpbIm9zbTpub2RlOjIiLCJvc206bm9kZTozMCIsIm9zbTp3YXk6MTAiLCJsaXN0aW5nOjAxIl0sImQiOlt7ImsiOiJjaXJjbGUiLCJvIjoiYWdlbnQiLCJsIjoiMTAtbWludXRlIHdhbGsiLCJjIjpbMTIxLjU0MzYsMjUuMDMzNF0sInIiOjgwMH0seyJrIjoicG9seWdvbiIsIm8iOiJ1c2VyIiwibCI6Im15IHdhbGsiLCJnIjpbMTIxLjU0LDI1LjAzMSwxMjEuNTQ2LDI1LjAzMSwxMjEuNTQ2LDI1LjAzNiwxMjEuNTQsMjUuMDM2XX0seyJrIjoibGluZSIsIm8iOiJ1c2VyIiwiZyI6WzEyMS41MywyNS4wMywxMjEuNTQsMjUuMDNdfV0sImEiOlt7Im8iOiJhZ2VudCIsInAiOlsxMjEuNTQzNiwyNS4wMzM0XSwibiI6Ik5lYXJlc3Qgc3VwZXJtYXJrZXQsIDIwMCBtIiwiaSI6InN0YXIifSx7Im8iOiJ1c2VyIiwicCI6WzEyMS41MzUsMjUuMDMzXSwibiI6IuWkp-Wuieajruael-WFrOWckuermSAyIOiZn-WHuuWPoyDwn5qHIiwiaSI6IvCfmocifV19";

/**
 * The same map with two categories declared, as the build that introduced `t`
 * wrote it (T-63). Frozen for the same reason as the v1 link above: a link
 * someone sent before v3 existed has to keep meaning exactly what it meant,
 * and a codec that changed one byte of it would only be caught by a fixture.
 */
const V2_DEMO_LINK =
  "v2.eyJjIjpbMTIxLjUzNzUsMjUuMDMyNV0sInoiOjE0LCJzIjpbIm9zbTpub2RlOjIiLCJvc206bm9kZTozMCIsIm9zbTp3YXk6MTAiLCJsaXN0aW5nOjAxIl0sImQiOlt7ImsiOiJjaXJjbGUiLCJvIjoiYWdlbnQiLCJsIjoiMTAtbWludXRlIHdhbGsiLCJjIjpbMTIxLjU0MzYsMjUuMDMzNF0sInIiOjgwMH0seyJrIjoicG9seWdvbiIsIm8iOiJ1c2VyIiwibCI6Im15IHdhbGsiLCJnIjpbMTIxLjU0LDI1LjAzMSwxMjEuNTQ2LDI1LjAzMSwxMjEuNTQ2LDI1LjAzNiwxMjEuNTQsMjUuMDM2XX0seyJrIjoibGluZSIsIm8iOiJ1c2VyIiwiZyI6WzEyMS41MywyNS4wMywxMjEuNTQsMjUuMDNdfV0sImEiOlt7Im8iOiJhZ2VudCIsInAiOlsxMjEuNTQzNiwyNS4wMzM0XSwibiI6Ik5lYXJlc3Qgc3VwZXJtYXJrZXQsIDIwMCBtIiwiaSI6InN0YXIifSx7Im8iOiJ1c2VyIiwicCI6WzEyMS41MzUsMjUuMDMzXSwibiI6IuWkp-Wuieajruael-WFrOWckuermSAyIOiZn-WHuuWPoyDwn5qHIiwiaSI6IvCfmocifV0sInQiOlsiYmFrZXJ5IiwiY2FmZSJdfQ";

/** A v2 hash built by hand, for payloads encodeShareState would never write. */
const wireV2 = (payload: unknown) =>
  `v2.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;

describe("share codec: the categories a link declares", () => {
  const WITH_CATEGORIES: ShareState = { ...DEMO, categories: ["cafe", "bakery"] };

  it("carries category names, not the features in them", () => {
    // The sender has 2297 cafes in memory; the link says "cafe". Anything else
    // is a data transfer through a URL, and the recipient can fetch the same
    // file from the same origin for free.
    const out = decoded(WITH_CATEGORIES);
    expect(out.categories).toEqual(["bakery", "cafe"]);
    const cost = utf8Bytes(encodeShareState(WITH_CATEGORIES)) - utf8Bytes(encodeShareState(DEMO));
    expect(cost).toBeLessThan(40);
  });

  it("sorts and dedupes them, so two maps holding the same data produce the same link", () => {
    // The hash mirror rewrites the address bar whenever the string changes; a
    // link that depended on the order the categories were asked for would
    // rewrite it over a difference nobody can see.
    expect(decoded({ ...DEMO, categories: ["cafe", "bakery", "cafe"] }).categories).toEqual([
      "bakery",
      "cafe",
    ]);
    expect(encodeShareState({ ...DEMO, categories: ["cafe", "bakery"] })).toBe(
      encodeShareState({ ...DEMO, categories: ["bakery", "cafe"] }),
    );
  });

  it("marks a link that needs categories as v2, so an older build cannot half-apply it", () => {
    // A build that read this as v1 would ignore `t`, restore the camera and the
    // shapes, and then quietly resolve none of the selected cafes - and, being
    // the same build that rewrites the address bar from the store, hand the
    // recipient a link without them. The prefix does not make that loud - a v1
    // build discards an unreadable link in silence and overwrites the fragment
    // with its own state (see the Versioning note in share.ts) - but it does
    // make it total: no half-restored map that both sides believe in.
    expect(encodeShareState(WITH_CATEGORIES).startsWith("v2.")).toBe(true);
    expect(encodeShareState(DEMO).startsWith("v1.")).toBe(true);
  });

  it("writes exactly the bytes it always did when nothing tier-2 is loaded", () => {
    expect(encodeShareState(DEMO)).toBe(V1_DEMO_LINK);
    // An empty list is not a declaration: a page that never touched tier-2 pays
    // nothing for the field existing.
    expect(encodeShareState({ ...DEMO, categories: [] })).toBe(V1_DEMO_LINK);
  });

  it("still opens a link written before categories existed", () => {
    const out = decodeShareState(V1_DEMO_LINK);
    if ("error" in out) throw new Error(out.error);
    expect(out.view).toEqual(VIEW);
    expect(out.selection).toEqual(DEMO.selection);
    expect(out.drawings).toHaveLength(3);
    expect(out.annotations).toHaveLength(2);
    // Nothing was declared, so nothing is pending: the old link means exactly
    // what it always meant.
    expect(out.categories).toEqual([]);
  });

  it("re-encodes a v2 link byte for byte, so opening one does not rewrite the bar", () => {
    expect(encodeShareState(decoded(WITH_CATEGORIES))).toBe(encodeShareState(WITH_CATEGORIES));
  });

  it("writes and reads the exact v2 bytes it wrote when the version shipped", () => {
    // The other half of the frozen-fixture law, added when v3 arrived: every
    // later version has to leave both older ones alone, in both directions.
    // Byte equality on the encode side and a full restore on the decode side,
    // because a link in a chat window is only worth what it still opens as.
    expect(encodeShareState(WITH_CATEGORIES)).toBe(V2_DEMO_LINK);

    const out = decodeShareState(V2_DEMO_LINK);
    if ("error" in out) throw new Error(out.error);
    expect(out.view).toEqual(VIEW);
    expect(out.selection).toEqual(DEMO.selection);
    expect(out.categories).toEqual(["bakery", "cafe"]);
    expect(out.drawings).toEqual(decoded(DEMO).drawings);
    expect(out.annotations).toEqual(DEMO.annotations);
  });

  it("drops a name this build cannot load instead of failing the whole link", () => {
    // Only a newer build can name a category this one has no file for. The map,
    // the shapes and the notes still arrive; the features of that category are
    // simply not there, which the restore path reports as ids it cannot resolve.
    const out = decodeShareState(
      wireV2({ c: [121.5, 25], z: 14, t: ["cafe", "teleport_pad", 7, "cafe"] }),
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.categories).toEqual(["cafe"]);
  });

  it("ignores a t that is not a list of names", () => {
    for (const t of ["cafe", { cafe: true }, 7, null]) {
      const out = decodeShareState(wireV2({ c: [121.5, 25], z: 14, t }));
      if ("error" in out) throw new Error(out.error);
      expect(out.categories).toEqual([]);
    }
  });

  it("costs the whole vocabulary less than ten selected features", () => {
    // This measurement is why get_share_link's too-large answer never blames
    // the loaded categories: an agent told to unload data to fit a link would
    // be throwing the map away for 3 % of the budget.
    const bare: ShareState = { ...DEMO, selection: [], drawings: [], annotations: [] };
    const everything = utf8Bytes(encodeShareState({ ...bare, categories: TIER2_CATEGORIES }));
    const cost = everything - utf8Bytes(encodeShareState(bare));
    // Pinned rather than bounded: get_share_link's too-large answer quotes this
    // number to the agent, so a 19th category (one name is about 16 bytes) has
    // to update that copy instead of quietly making it wrong.
    expect(cost).toBe(268);
    expect(cost).toBeLessThan(MAX_SHARE_URL_BYTES / 20);
    // Nine selected POIs — ids the length the shipped extract actually uses —
    // cost more than naming all 18 categories, and select_features will
    // highlight up to 500 of them.
    const nineIds = utf8Bytes(
      encodeShareState({
        ...bare,
        selection: Array.from({ length: 9 }, (_, i) => `osm:node:1000102801${i}`),
      }),
    );
    expect(cost).toBeLessThan(nineIds - utf8Bytes(encodeShareState(bare)));
  });
});

/** A v3 hash built by hand, for payloads encodeShareState would never write. */
const wireV3 = (payload: unknown) =>
  `v3.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;

/** The link this codec wrote before v3: the same line, with its points as JSON numbers. */
function flatLink(line: ShareDrawing): string {
  const coordinates = (line.geometry as LineString).coordinates;
  return wire({ c: VIEW.center, z: VIEW.zoom, d: [{ k: "line", o: "user", g: coordinates.flat() }] });
}

/**
 * A drawing too big to write as numbers — `v3`.
 *
 * A coordinate as JSON says nothing about the point before it, though a traced
 * outline's points differ in their last two digits, so a 500-point shape cost
 * more than the entire URL budget and the map holding one had no link at all.
 * v3 writes the differences instead. Three things have to be true of that, and
 * the third is the one worth breaking a build over:
 *
 *  1. The link fits. That is the only reason to have written any of this.
 *  2. The link decodes to the same map, point for point, at the same 5
 *     decimals every tool answer prints — not to a simplified one. Losing
 *     points is a decision about somebody's map and is never taken quietly by
 *     the thing that spells it.
 *  3. Nothing older changes. A version that fits a bigger map is worth nothing
 *     if it costs the links people have already sent, so v3 appears only where
 *     the alternative was no link, and every smaller map still writes the v1 or
 *     v2 bytes it wrote yesterday.
 */
describe("share codec: a drawing too big to write as numbers", () => {
  const CAMERA_ONLY: ShareState = { view: VIEW, selection: [], drawings: [], annotations: [] };

  it("fits a 500-point route into a whole demo map's link", () => {
    // The measurement the feature exists for. "Before" is the route on an
    // otherwise empty map, because that is already over the budget; "after" is
    // the same route on top of the full demo map - camera, four selected
    // features, three other shapes and two notes.
    const line = routeOf(MAX_SHAPE_POINTS);
    const before = utf8Bytes(flatLink(line));
    const after = utf8Bytes(encodeShareState({ ...DEMO, drawings: [...DEMO.drawings, line] }));
    // Measured: 12 453 bytes for the route and a camera, half as much again as
    // a URL may be, against 3 341 for the whole demo map with the route on it.
    expect(before).toBeGreaterThan(MAX_SHARE_URL_BYTES);
    expect(after).toBeLessThan(MAX_SHARE_URL_BYTES);
    expect(after).toBeLessThan(before / 3);
  });

  it("restores the sender's points, every one of them, to the same 5 decimals", () => {
    // Claim 2. `toEqual` against the drawing that went in, not a tolerance or a
    // point count: a route the recipient sees a metre off, or 499 points of,
    // is a map the two sides quietly disagree about.
    const line = routeOf(MAX_SHAPE_POINTS);
    const out = decoded({ ...CAMERA_ONLY, drawings: [line] });
    expect(out.drawings).toEqual([line]);
  });

  it("spells the same map differently, rather than encoding a smaller one", () => {
    // The anti-simplification law, stated where it can fail: the flat form and
    // the polyline form of one drawing decode to the identical shape. If a
    // future "optimisation" ever dropped a point, this is what would catch it.
    const line = routeOf(120);
    const flat = decodeShareState(flatLink(line));
    const packed = decoded({ ...CAMERA_ONLY, drawings: [line] });
    if ("error" in flat) throw new Error(flat.error);
    expect(packed.drawings).toEqual(flat.drawings);
  });

  it("switches versions on size, so a map that fits keeps writing v1", () => {
    // The write rule, exactly as documented: the flat form goes out unless it
    // is over the threshold. A 4-point polygon would be a few bytes shorter as
    // a polyline and still must not flip - a v1 build refuses a v3 link whole,
    // and that is not a price worth paying to save bytes nobody needed.
    const versions = new Set<string>();
    for (const points of [4, 40, 200, 300, 400, MAX_SHAPE_POINTS]) {
      const line = routeOf(points);
      const hash = encodeShareState({ ...CAMERA_ONLY, drawings: [line] });
      const flatBytes = utf8Bytes(flatLink(line));
      expect(hash.startsWith("v3."), `${points} points, ${flatBytes} flat bytes`).toBe(
        flatBytes > SHARE_POLYLINE_THRESHOLD_BYTES,
      );
      versions.add(hash.slice(0, 3));
    }
    // Both branches were actually taken, or the assertion above proves nothing.
    expect([...versions].sort()).toEqual(["v1.", "v3."]);
    expect(encodeShareState(DEMO)).toBe(V1_DEMO_LINK);
  });

  it("leaves a map made large by its selection alone on the version it was on", () => {
    // Polylines shrink coordinates, not ids. Re-labelling this map v3 would
    // cost every older reader and save nothing, so the encoder keeps the
    // smaller-or-equal form: the same bytes under a version fewer builds
    // understand is not a trade.
    const many: ShareState = {
      ...CAMERA_ONLY,
      selection: Array.from({ length: 500 }, (_, i) => `osm:node:${100000 + i}`),
    };
    const hash = encodeShareState(many);
    expect(utf8Bytes(hash)).toBeGreaterThan(SHARE_POLYLINE_THRESHOLD_BYTES);
    expect(hash.startsWith("v1.")).toBe(true);
  });

  it("still declares its categories, so a big map is not a downgraded one", () => {
    // v3 supersedes v2 rather than replacing it. A link that dropped `t` on the
    // way to fitting would hand the recipient a selection of points of interest
    // nothing on their page will ever resolve.
    const big: ShareState = {
      ...CAMERA_ONLY,
      selection: ["osm:node:100"],
      drawings: [routeOf(MAX_SHAPE_POINTS)],
      categories: ["cafe"],
    };
    expect(encodeShareState(big).startsWith("v3.")).toBe(true);
    expect(decoded(big).categories).toEqual(["cafe"]);
  });

  it("re-encodes a v3 link byte for byte, so opening one does not rewrite the bar", () => {
    // Same law as v1 and v2: the address-bar mirror compares strings, so a
    // decode/encode cycle that drifted would rewrite the URL and push a history
    // entry for a map nobody moved.
    const big: ShareState = { ...DEMO, drawings: [...DEMO.drawings, routeOf(MAX_SHAPE_POINTS)] };
    const hash = encodeShareState(big);
    expect(hash.startsWith("v3.")).toBe(true);
    expect(encodeShareState(decoded(big))).toBe(hash);
  });
});

describe("share codec: v3 links written by someone else", () => {
  const HOSTILE_V3: { name: string; hash: string }[] = [
    { name: "not base64url", hash: "v3.@@@@" },
    { name: "base64 of not-JSON", hash: `v3.${Buffer.from("hello", "utf8").toString("base64url")}` },
    { name: "no camera", hash: wireV3({ d: [{ k: "line", o: "user", e: "AABB" }] }) },
  ];

  it.each(HOSTILE_V3)("returns an error string for $name, never a throw", ({ hash }) => {
    const out = decodeShareState(hash);
    expect(out, hash.slice(0, 24)).toHaveProperty("error");
  });

  it("drops the shapes whose polyline it cannot read and keeps the rest of the map", () => {
    // The established failure shape, unchanged: a whole-payload problem loses
    // the link, an item-level one loses the item. One mangled shape in a
    // hand-edited link must not cost the other shapes, the notes or the camera
    // - and get_share_link reads its own links back, so a shape lost this way
    // is reported to the human as `omitted` rather than discovered elsewhere.
    const out = decodeShareState(
      wireV3({
        c: [121.5, 25],
        z: 14,
        d: [
          { k: "line", o: "user", e: "AA*AA" }, // a character from no alphabet of ours
          { k: "line", o: "user", e: "AAAA_" }, // truncated mid-number
          { k: "line", o: "user", e: encodePolyline([181, 91, 182, 92]) }, // off the planet
          { k: "line", o: "user" }, // no coordinates at all
          { k: "line", o: "agent", e: encodePolyline([121.5, 25, 121.6, 25.1]) },
        ],
        a: [{ o: "agent", p: [121.5, 25], n: "kept" }],
      }),
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.drawings.map((d) => d.source)).toEqual(["agent"]);
    expect(out.annotations.map((a) => a.note)).toEqual(["kept"]);
    expect(out.view.center).toEqual([121.5, 25]);
  });

  it("holds a polyline to the same ceiling draw_shape enforces on a list", () => {
    // The compact form must not become a way around the tool layer's limits:
    // one paste and the human's map renders a million points per frame.
    const tooMany = encodePolyline(
      Array.from({ length: (MAX_SHAPE_POINTS + 1) * 2 }, (_, i) =>
        i % 2 ? 25 + i / 1e6 : 121.5 + i / 1e6,
      ),
    );
    const out = decodeShareState(wireV3({ c: [121.5, 25], z: 14, d: [{ k: "line", o: "user", e: tooMany }] }));
    if ("error" in out) throw new Error(out.error);
    expect(out.drawings).toEqual([]);
  });

  it("reads a polyline only from a link that calls itself v3", () => {
    // The version prefix is the whole compatibility contract. If a v1-labelled
    // link could carry v3 geometry, a build that only knows v1 would accept the
    // link, restore the map without that shape, and tell nobody - the
    // half-applied restore the prefix exists to prevent.
    const drawing = { k: "line", o: "user", e: encodePolyline([121.5, 25, 121.6, 25.1]) };
    const asV1 = decodeShareState(wire({ c: [121.5, 25], z: 14, d: [drawing] }));
    const asV3 = decodeShareState(wireV3({ c: [121.5, 25], z: 14, d: [drawing] }));
    if ("error" in asV1 || "error" in asV3) throw new Error("expected both links to decode");
    expect(asV1.drawings).toEqual([]);
    expect(asV3.drawings).toHaveLength(1);
  });

  it("still reads a flat list inside a v3 link", () => {
    // v3 is a superset, not a replacement: a newer build that mixed the forms
    // - or a link hand-edited from a v1 one - has to open here.
    const out = decodeShareState(
      wireV3({ c: [121.5, 25], z: 14, d: [{ k: "line", o: "user", g: [121.5, 25, 121.6, 25.1] }] }),
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.drawings).toHaveLength(1);
  });
});

interface SelectResult {
  selected?: { id: string }[];
  pending_ids?: string[];
  unknown_ids?: string[];
  state: MapStateOutput;
}

/** One page: the six bundled datasets, a tier-2 server, and the tools over them. */
function page(tier2FetchJson: FetchJson) {
  const store = createMemoryToolStore({
    view: VIEW,
    features: FIXTURE_FEATURES,
    tier2FetchJson,
  });
  const tools = createMapTools(store, { getBaseUrl: () => BASE_URL });
  const tool = (name: string) => tools.find((t) => t.name === name) as GlassMapTool;
  const select = tool("select_features");
  const share = tool("get_share_link");
  return {
    store,
    select: async (input: Record<string, unknown>) =>
      (await select.execute(input, { signal })) as SelectResult,
    share: async () => (await share.execute({}, { signal })) as ShareResult,
  };
}

/**
 * What T-64's `useShareHash` has to do, written out rather than hidden in a
 * helper, because the *order* is the contract: the view and the selection land
 * in the store first, and the categories are declared before anything awaits.
 */
function applyLink(store: MemoryToolStore, url: string) {
  const link = decodeShareState(url.slice(url.indexOf("#")));
  if ("error" in link) throw new Error(link.error);
  store.setView(link.view);
  store.setSelection(link.selection);
  return { link, settled: store.restoreCategories(link.categories) };
}

/** Two selected cafes on a map that loaded the cafe file — the case that was broken. */
async function cafeLink(): Promise<string> {
  const sender = page(createTier2Fetch().fetchJson);
  await sender.store.loadCategory("cafe");
  sender.store.setSelection(["osm:node:100", "osm:node:101"]);
  const out = await sender.share();
  if (!out.url) throw new Error(out.error);
  return out.url;
}

describe("get_share_link: the categories the map has loaded", () => {
  it("names them, so the other side fetches the same files", async () => {
    const url = await cafeLink();
    const restored = decodeShareState(url.slice(url.indexOf("#")));
    if ("error" in restored) throw new Error(restored.error);
    expect(restored.categories).toEqual(["cafe"]);
    expect(restored.selection).toEqual(["osm:node:100", "osm:node:101"]);
    expect(url).toContain("#v2.");
  });

  it("says nothing at all when the page never touched a category", async () => {
    // The overwhelmingly common link, and the one every existing paste is: it
    // must stay the exact v1 link this build produced before categories
    // existed, down to the byte.
    const { call } = shareTool({ view: VIEW, selection: ["osm:node:2"] });
    const out = await call();
    expect(out.url).toBe(
      `${BASE_URL}#v1.eyJjIjpbMTIxLjUzNzUsMjUuMDMyNV0sInoiOjE0LCJzIjpbIm9zbTpub2RlOjIiXX0`,
    );
  });

  it("declares a category that is still arriving, so re-sharing a link keeps it", async () => {
    // A recipient can copy the link out of the address bar the moment the page
    // opens - the mirror rewrites it 300 ms in, long before a category file has
    // landed. A link built from "what finished loading" would drop the very
    // thing that makes the selection resolvable, and the map would degrade one
    // forward at a time.
    const url = await cafeLink();
    const { fetchJson, release } = createGatedTier2Fetch();
    const recipient = page(fetchJson);
    const { settled } = applyLink(recipient.store, url);

    const reshared = await recipient.share();
    expect(reshared.url).toBe(url);

    release();
    await settled;
    expect((await recipient.share()).url).toBe(url);
  });
});

describe("opening a shared map on a page with no categories loaded", () => {
  it("declares the link's categories before the first byte arrives", async () => {
    // Everything that runs in this window - the debounced hash mirror, the
    // agent's next tool call - has to be able to tell "not loaded yet" from
    // "not real". Only a synchronous declaration can tell it.
    const url = await cafeLink();
    const { fetchJson, release } = createGatedTier2Fetch();
    const recipient = page(fetchJson);
    const { settled } = applyLink(recipient.store, url);

    expect(recipient.store.getPendingCategories()).toEqual(["cafe"]);
    expect(recipient.store.getFeatures()).toHaveLength(FIXTURE_FEATURES.length);

    release();
    await settled;
    expect(recipient.store.getPendingCategories()).toEqual([]);
    expect(recipient.store.getLoadedCategories()).toEqual(["cafe"]);
  });

  it("keeps the selection the link carried while its category is still loading", async () => {
    // The bug this exists to stop: select_features pruned ids it could not
    // resolve, the store told the address-bar mirror about the smaller
    // selection, and the recipient's own URL came to promise less than the one
    // they were sent - while the sender watched the map they shared.
    const url = await cafeLink();
    const { fetchJson, release } = createGatedTier2Fetch();
    const recipient = page(fetchJson);
    const { settled } = applyLink(recipient.store, url);

    const added = await recipient.select({ ids: ["osm:way:10"], replace: false });
    expect(added.state.selection.ids).toEqual(["osm:node:100", "osm:node:101", "osm:way:10"]);
    // Not described as selected features - nothing here can name them yet - but
    // named as what they are: still coming.
    expect(added.pending_ids).toEqual(["osm:node:100", "osm:node:101"]);
    expect(added.selected?.map((f) => f.id)).toEqual(["osm:way:10"]);
    expect(added.state.tier2?.loading).toEqual(["cafe"]);

    release();
    await settled;

    const after = await recipient.select({ ids: [], replace: false });
    expect(after.state.selection.ids).toEqual(["osm:node:100", "osm:node:101", "osm:way:10"]);
    expect(after.pending_ids).toBeUndefined();
    expect(after.selected?.map((f) => f.id)).toEqual([
      "osm:node:100",
      "osm:node:101",
      "osm:way:10",
    ]);
    expect(after.state.tier2?.loading).toBeUndefined();
  });

  it("selects an id the link's categories will contain, without calling it unknown", async () => {
    // "Just show me the Daan cafe" is a normal thing to say about a link that
    // has only just been opened, and replace:true means nothing else retains
    // the id. Reporting it as unknown *and* dropping it would leave the map
    // holding neither the link's selection nor the one feature the agent was
    // asked for - and the address bar, written from the store, carries that
    // loss on to the next person.
    const url = await cafeLink();
    const { fetchJson, release } = createGatedTier2Fetch();
    const recipient = page(fetchJson);
    const { settled } = applyLink(recipient.store, url);

    const narrowed = await recipient.select({
      ids: ["osm:node:101", "osm:way:10", "gone:404"],
      replace: true,
    });
    // The split: what this page can name, and what it is still waiting for.
    expect(narrowed.selected?.map((f) => f.id)).toEqual(["osm:way:10"]);
    expect(narrowed.pending_ids).toEqual(["osm:node:101", "gone:404"]);
    // Nothing is unknown while a category is in flight: a POI id names no
    // category ("osm:node:<n>"), so this page cannot yet tell an id the cafe
    // file will contain from one nothing will. It keeps both, and the window
    // closes on its own - "gone:404" is pruned by the first call after that.
    expect(narrowed.unknown_ids).toEqual([]);
    expect(narrowed.state.selection.ids).toEqual(["osm:node:101", "osm:way:10", "gone:404"]);

    release();
    await settled;

    const after = await recipient.select({ ids: [], replace: false });
    expect(after.pending_ids).toBeUndefined();
    expect(after.selected?.map((f) => f.id)).toEqual(["osm:node:101", "osm:way:10"]);
  });

  it("still names what it matched when more pending ids than the cap come first", async () => {
    // The cap is on the answer, not on the map: a link can carry a selection
    // far larger than the 20 ids an answer lists. Capping before splitting
    // pending off would spend every slot on ids this page cannot name yet and
    // answer "selected: []" to a call that did match a feature - and an agent
    // reading that reports the human's selection as having failed.
    const many = Array.from({ length: SELECTION_ID_LIMIT + 5 }, (_, i) => `osm:node:9${i}`);
    const hash = encodeShareState({
      view: VIEW,
      selection: many,
      drawings: [],
      annotations: [],
      categories: ["cafe"],
    });
    const { fetchJson, release } = createGatedTier2Fetch();
    const recipient = page(fetchJson);
    const { settled } = applyLink(recipient.store, `${BASE_URL}#${hash}`);

    const out = await recipient.select({ ids: ["osm:way:10"], replace: false });
    expect(out.selected?.map((f) => f.id)).toEqual(["osm:way:10"]);
    expect(out.pending_ids).toHaveLength(SELECTION_ID_LIMIT);
    // Nothing was dropped from the map itself, only from the answer.
    expect(out.state.selection.count).toBe(many.length + 1);

    release();
    await settled;
  });

  it("prunes the ids only once the failure has surfaced, and says which file failed", async () => {
    // The exemption ends when the answer is known, not when the page gives up
    // waiting: a category that will never load must not keep dead ids in the
    // selection forever, and the reason has to be somewhere the agent reads
    // anyway - state, which every write tool returns.
    const url = await cafeLink();
    const recipient = page(createTier2Fetch({}).fetchJson); // the index, and no files
    const { settled } = applyLink(recipient.store, url);

    const kept = await recipient.select({ ids: [], replace: false });
    expect(kept.state.selection.ids).toEqual(["osm:node:100", "osm:node:101"]);

    const result = await settled;
    expect(result.ok).toBe(false);
    expect(result.failed.map((f) => f.category)).toEqual(["cafe"]);
    expect(result.failed[0].error).toMatch(/cafe\.geojson: 404/);
    expect(recipient.store.getPendingCategories()).toEqual([]);

    const pruned = await recipient.select({ ids: [], replace: false });
    expect(pruned.state.selection.ids).toEqual([]);
    expect(pruned.state.tier2?.failed).toEqual([
      { category: "cafe", error: expect.stringMatching(/cafe/) },
    ]);
  });

  it("still drops ids nothing declared, so the exemption is not a licence to keep dead ones", async () => {
    // Without this the fix would be "never prune", and a link from a build with
    // different data would leave ids in the selection that no longer name
    // anything - the leftovers the pruning was written for.
    const recipient = page(createTier2Fetch().fetchJson);
    recipient.store.setSelection(["osm:node:100", "osm:way:10"]);
    const out = await recipient.select({ ids: [], replace: false });
    expect(out.state.selection.ids).toEqual(["osm:way:10"]);
    expect(out.pending_ids).toBeUndefined();
  });

  it("keeps declaring a category the recipient's page failed to fetch for a moment", async () => {
    // The recipient's cafe file answered 503, so the restore gave up on it -
    // and every link this page hands on is built from this same store. A link
    // built from what loaded would quietly drop cafe, and the person the
    // recipient forwards it to gets the sender's two cafe ids with no category
    // declaring them: a selection nothing on that page will ever resolve, from
    // a link that looks perfectly well formed. One bad second, and the map
    // degrades one reader at a time. What the recipient hands on is what they
    // were sent, and the next page asks the server again.
    const url = await cafeLink();
    const recipient = page(createFlakyTier2Fetch("cafe").fetchJson);
    const { settled } = applyLink(recipient.store, url);

    const result = await settled;
    expect(result.failed[0]).toMatchObject({ category: "cafe", permanent: false });
    expect((await recipient.share()).url).toBe(url);
  });

  it("stops declaring a category this deployment does not ship at all", async () => {
    // The other half of the same rule. A 404 is not a bad second: no reader of
    // this link will ever get that file, and a link that keeps naming it only
    // makes each of them wait for the same missing request. The page has
    // already pruned the ids that depended on it, for the same reason.
    const url = await cafeLink();
    const recipient = page(createTier2Fetch({}).fetchJson); // the index, and no files
    const { settled } = applyLink(recipient.store, url);

    const result = await settled;
    expect(result.failed[0]).toMatchObject({ category: "cafe", permanent: true });

    const reshared = await recipient.share();
    if (!reshared.url) throw new Error(reshared.error);
    const decoded = decodeShareState(reshared.url.slice(reshared.url.indexOf("#")));
    if ("error" in decoded) throw new Error(decoded.error);
    expect(decoded.categories).toEqual([]);
  });

  it("reproduces the sender's link byte for byte once the categories are loaded", async () => {
    // The whole law in one assertion: two browsers, no server, same URL.
    const url = await cafeLink();
    const recipient = page(createTier2Fetch().fetchJson);
    const { settled } = applyLink(recipient.store, url);
    await settled;

    expect((await recipient.share()).url).toBe(url);
    const cafes = recipient.store
      .getFeatures()
      .filter((f) => f.properties.category === "cafe")
      .map((f) => f.properties.id);
    expect(cafes).toContain("osm:node:100");
  });
});

/**
 * `su` — which of the selected ids the human picked themselves.
 *
 * The link is the only place a recipient can learn anything about who did
 * what, and the map on the other side says it out loud ("selected by the
 * agent"). One rule governs the whole key: **it may only ever narrow a claim.**
 * A link that carries nothing new must weigh nothing new, byte for byte, and a
 * link that carries it must never let a reader assert more than the sender
 * actually recorded.
 */
describe("share codec: who selected these features", () => {
  const HUMAN_ID = "osm:way:10";
  const humanDemo: ShareState = { ...DEMO, userSelected: [HUMAN_ID] };

  it("costs an agent-only map nothing at all: the same bytes, to the byte", () => {
    // The byte-identity design, and the reason there is no version bump: every
    // link written before this key existed, and every link a map the agent
    // selected alone writes tomorrow, is the same string. An encoder that
    // wrote `su: []` would invalidate every golden link and every recipient's
    // "did the bar change?" comparison for a fact worth nothing.
    expect(encodeShareState(DEMO)).toBe(V1_DEMO_LINK);
    expect(encodeShareState({ ...DEMO, userSelected: [] })).toBe(V1_DEMO_LINK);
    // Not selected is not attributable: an id outside `s` annotates nothing.
    expect(encodeShareState({ ...DEMO, userSelected: ["osm:node:999"] })).toBe(V1_DEMO_LINK);
    // And a map with no selection at all cannot grow one through this key.
    const noSelection: ShareState = { ...DEMO, selection: [], userSelected: [HUMAN_ID] };
    expect(encodeShareState(noSelection)).toBe(
      encodeShareState({ ...DEMO, selection: [], userSelected: undefined }),
    );
  });

  it("carries the human's ids and stays a v1 link an older build can still read", () => {
    // Ignorable by construction: a build that has never heard of `su` drops it
    // with every other unknown key and restores exactly the map it always did.
    const hash = encodeShareState(humanDemo);
    expect(hash.startsWith("v1.")).toBe(true);
    const out = decoded(humanDemo);
    expect(out.selection).toEqual(DEMO.selection);
    expect(out.userSelected).toEqual([HUMAN_ID]);
  });

  it("orders `su` by the selection, so the same map always makes the same link", () => {
    // The address bar is rewritten on any string difference; a key ordered by
    // the sequence of clicks would rewrite it over a difference nobody can see.
    const a = encodeShareState({ ...DEMO, userSelected: ["osm:way:10", "osm:node:2"] });
    const b = encodeShareState({ ...DEMO, userSelected: ["osm:node:2", "osm:way:10"] });
    expect(a).toBe(b);
    expect(encodeShareState(decoded({ ...DEMO, userSelected: ["osm:way:10", "osm:node:2"] }))).toBe(a);
  });

  it("tells 'the link said nothing' apart from 'the link said none of these'", () => {
    // The razor the hedged copy hangs on. Absent means unknown - which every
    // link written before this key is - and unknown may not be printed as a
    // fact about the agent. Empty means the sender looked and found none.
    const legacy = decodeShareState(V1_DEMO_LINK);
    if ("error" in legacy) throw new Error(legacy.error);
    expect(legacy.userSelected).toBeUndefined();
    expect(selectionAttributionExplicit(legacy)).toBe(false);

    const stated = decodeShareState(wire({ c: [121.5, 25], z: 14, s: ["osm:node:2"], su: [] }));
    if ("error" in stated) throw new Error(stated.error);
    expect(stated.userSelected).toEqual([]);
    expect(selectionAttributionExplicit(stated)).toBe(true);

    expect(selectionAttributionExplicit(decoded(humanDemo))).toBe(true);
  });

  it("treats a hand-edited `su` as an annotation of `s` and nothing more", () => {
    // A link is written by whoever sends it. Ids it marks as human-selected
    // but never selected would otherwise become a selection the recipient
    // never asked for, or a name in a sentence about a feature not on screen.
    const out = decodeShareState(
      wire({ c: [121.5, 25], z: 14, s: ["osm:node:2"], su: ["osm:node:2", "osm:way:99", 7] }),
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.selection).toEqual(["osm:node:2"]);
    expect(out.userSelected).toEqual(["osm:node:2"]);

    // A `su` that is not a list says nothing, exactly like no `su` at all.
    const bogus = decodeShareState(wire({ c: [121.5, 25], z: 14, s: ["osm:node:2"], su: "mine" }));
    if ("error" in bogus) throw new Error(bogus.error);
    expect(bogus.userSelected).toBeUndefined();
  });
});

/**
 * The recipient's own link — the round trip `su` exists to survive.
 *
 * The address bar is rewritten from the *store*, not from the link that filled
 * it, so whatever the restore fails to record is gone from every link the
 * recipient sends on, and from the page's own state after a reload. That makes
 * "what the restore records" a wire property, tested here beside the codec:
 * restore-then-re-encode has to be a fixed point, or a link degrades a little
 * every time it is passed along.
 */
describe("share codec: what a restored map says about itself", () => {
  /** The restore, as `applyShareHash` will perform it (T-82/83 wire it up). */
  const restoreInto = (store: MemoryToolStore, hash: string) => {
    const out = decodeShareState(hash);
    if ("error" in out) throw new Error(out.error);
    store.setSelection(out.selection, restoredSelectionSources(out));
    return out;
  };

  /** The mirror, as `shareStateOf` will write it: from the store, every time. */
  const mirrorOf = (store: MemoryToolStore, view: MapView) =>
    encodeShareState({
      view,
      selection: store.getSelection(),
      userSelected: userSelectedIds(store.getSelection(), store.getSelectionSources()),
      drawings: [],
      annotations: [],
    });

  it("keeps a proven-human map proven: the recipient's own link still carries `su`", () => {
    // The trap, and the reason the restore records anything at all. A map its
    // owner selected by hand decodes as no agent work (`restoredAgentStateOf`
    // false). If the recipient's store forgets who selected those ids, the
    // mirror re-encodes them `su`-less, `su`-less reads as the agent's, and a
    // map with no agent anywhere in its history presents itself as an agent's
    // work on the next reload - to the recipient, and to everyone they pass
    // the link to after that.
    const sent = encodeShareState({
      view: VIEW,
      selection: ["osm:way:10", "osm:node:2"],
      userSelected: ["osm:way:10", "osm:node:2"],
      drawings: [],
      annotations: [],
    });
    const store = createMemoryToolStore();
    const out = restoreInto(store, sent);
    expect(restoredAgentStateOf(out)).toBe(false);
    expect(store.getSelectionSources()).toEqual({
      "osm:way:10": "user",
      "osm:node:2": "user",
    });

    const mirrored = mirrorOf(store, out.view);
    expect(mirrored).toBe(sent);
    const reread = decodeShareState(mirrored);
    if ("error" in reread) throw new Error(reread.error);
    expect(restoredAgentStateOf(reread)).toBe(false);
  });

  it("records what the link stated and no more, so a mixed link stays mixed", () => {
    // `su` names the human's ids; it does not name the agent's. The ids
    // outside it are recorded as nobody's, which is what keeps the mirror from
    // widening the sender's claim - and still reproduces the sender's link,
    // because the mirror only ever writes back what `su` carried.
    const sent = encodeShareState({
      view: VIEW,
      selection: ["osm:way:10", "osm:node:2"],
      userSelected: ["osm:node:2"],
      drawings: [],
      annotations: [],
    });
    const store = createMemoryToolStore();
    const out = restoreInto(store, sent);
    expect(store.getSelectionSources()).toEqual({ "osm:node:2": "user" });
    expect(mirrorOf(store, out.view)).toBe(sent);
  });

  it("adds no claim to a legacy link: `su`-less in, `su`-less out", () => {
    // The link that says nothing must not become a link that says something.
    // A restore that recorded a source it was never handed would turn every
    // legacy link into a false statement about its own sender.
    const sent = wire({ c: [121.5375, 25.0325], z: 14, s: ["osm:node:2", "osm:way:10"] });
    const store = createMemoryToolStore();
    const out = restoreInto(store, sent);
    expect(out.userSelected).toBeUndefined();
    expect(store.getSelectionSources()).toEqual({});
    const mirrored = mirrorOf(store, out.view);
    const reread = decodeShareState(mirrored);
    if ("error" in reread) throw new Error(reread.error);
    expect(reread.userSelected).toBeUndefined();
    expect(restoredAgentStateOf(reread)).toBe(true);
  });
});

/**
 * Whether a restored map already holds agent work — the bit the awakening and
 * every restored-state surface are built on. Getting it wrong in one direction
 * announces an agent that was never there; in the other it hides one that was,
 * which is the failure this whole product exists to prevent.
 */
describe("share codec: restoredAgentStateOf", () => {
  const link = (state: ShareState) => restoredAgentStateOf(decoded(state));
  const EMPTY: ShareState = { view: VIEW, selection: [], drawings: [], annotations: [] };

  it("is proven by a drawing or a note the agent made", () => {
    // `o` has ridden every link since the codec shipped, so this is a fact
    // about the wire and not a presumption about it.
    expect(link({ ...EMPTY, drawings: [CIRCLE] })).toBe(true);
    expect(link({ ...EMPTY, annotations: [DEMO.annotations[0]] })).toBe(true);
  });

  it("is false for a map a person made alone", () => {
    expect(link(EMPTY)).toBe(false);
    expect(link({ ...EMPTY, drawings: [USER_DRAWN_AREA], annotations: [DEMO.annotations[1]] })).toBe(
      false,
    );
    // Attributed, and attributed entirely to the human: the one selection that
    // is evidence of no agent at all.
    expect(
      link({ ...EMPTY, selection: ["osm:node:2"], userSelected: ["osm:node:2"] }),
    ).toBe(false);
  });

  it("presumes the agent for a selection the link does not attribute", () => {
    // The blessed presumption. `su`-less is one wire state covering both an old
    // link and a new all-agent one, and the two errors are not symmetric:
    // crediting the human for the agent's work hides that an agent was here,
    // while over-crediting the agent only over-announces a capability the page
    // is built to show. The copy hedges ("from a shared link"); the bit does
    // not, because behaviour has to choose.
    expect(link({ ...EMPTY, selection: ["osm:node:2"] })).toBe(true);
    // Attributed in part: whatever `su` does not name, the sender recorded as
    // the agent's.
    expect(
      link({ ...EMPTY, selection: ["osm:node:2", "osm:way:10"], userSelected: ["osm:node:2"] }),
    ).toBe(true);
  });

  it("reads the links people have already sent, which is every legacy shape there is", () => {
    // Two shapes exist in the wild: with drawings (proven) and selection-only
    // (presumed). Both have to answer without a `su` anywhere.
    const demoLink = decodeShareState(V1_DEMO_LINK);
    if ("error" in demoLink) throw new Error(demoLink.error);
    expect(restoredAgentStateOf(demoLink)).toBe(true);

    const selectionOnly = decodeShareState(
      wire({ c: [121.5375, 25.0325], z: 14, s: ["osm:node:2", "osm:way:10"] }),
    );
    if ("error" in selectionOnly) throw new Error(selectionOnly.error);
    expect(selectionOnly.userSelected).toBeUndefined();
    expect(restoredAgentStateOf(selectionOnly)).toBe(true);

    // A camera and nothing else is not agent work, however old the link is.
    const cameraOnly = decodeShareState(wire({ c: [121.5375, 25.0325], z: 14 }));
    if ("error" in cameraOnly) throw new Error(cameraOnly.error);
    expect(restoredAgentStateOf(cameraOnly)).toBe(false);
  });
});

describe("get_share_link: the selection's provenance", () => {
  const selectionUrl = async (tool: { call(): Promise<ShareResult> }) => {
    const out = await tool.call();
    if (!out.url) throw new Error(out.error);
    const decodedLink = decodeShareState(out.url.slice(out.url.indexOf("#")));
    if ("error" in decodedLink) throw new Error(decodedLink.error);
    return { url: out.url, decoded: decodedLink };
  };

  it("says which features the human picked, so the other side does not credit the agent", async () => {
    const { store, call } = shareTool({ features: FIXTURE_FEATURES, view: VIEW });
    store.setSelection(["osm:way:10"], "user");
    store.setSelection(["osm:way:10", "osm:node:2"], "agent");

    const { decoded: out } = await selectionUrl({ call });
    expect(out.selection).toEqual(["osm:way:10", "osm:node:2"]);
    expect(out.userSelected).toEqual(["osm:way:10"]);
    expect(restoredAgentStateOf(out)).toBe(true);
  });

  it("writes the same link it always did when the agent selected everything", async () => {
    // The proof that the key is free: the same map, with and without a
    // provenance record, is the same URL.
    const attributed = shareTool({ features: FIXTURE_FEATURES, view: VIEW });
    attributed.store.setSelection(["osm:way:10", "osm:node:2"], "agent");
    const plain = shareTool({ features: FIXTURE_FEATURES, view: VIEW });
    plain.store.setSelection(["osm:way:10", "osm:node:2"]);

    const a = await selectionUrl(attributed);
    const b = await selectionUrl(plain);
    expect(a.url).toBe(b.url);
    expect(a.decoded.userSelected).toBeUndefined();
  });

  it("carries nothing about ids the map is no longer showing", async () => {
    // The store prunes attribution when an id leaves the selection, so a link
    // can never name a feature it does not carry - which is what would make
    // `su` decode into an id nobody selected.
    const { store, call } = shareTool({ features: FIXTURE_FEATURES, view: VIEW });
    store.setSelection(["osm:way:10"], "user");
    store.setSelection(["osm:node:2"], "agent");

    const { decoded: out } = await selectionUrl({ call });
    expect(out.selection).toEqual(["osm:node:2"]);
    expect(out.userSelected).toBeUndefined();
  });
});
