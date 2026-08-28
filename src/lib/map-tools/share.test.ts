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
import { describe, expect, it } from "vitest";
import {
  decodeShareState,
  encodeShareState,
  MAX_SHARE_URL_BYTES,
  utf8Bytes,
  type ShareAnnotation,
  type ShareDrawing,
  type ShareState,
} from "./share";
import { createMapTools } from "./index";
import { createMemoryToolStore, type MapView } from "@/lib/store/map-store";
import type { GlassMapTool } from "@/lib/webmcp/types";
import { circleGeometry, MAX_SHAPE_POINTS } from "./shapes";
import { USER_DRAWN_AREA, USER_DRAWN_LINE, VIEW } from "./test-fixtures";

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

  it("refuses to hand out a link too long to survive being pasted", async () => {
    // A 500-point shape is legal for draw_shape and still overflows a URL, so
    // this is a real state, not a hypothetical one: the answer has to say which
    // part to remove instead of returning a link that arrives truncated.
    const ring = Array.from({ length: MAX_SHAPE_POINTS }, (_, i) => [
      121.5 + Math.cos((i / MAX_SHAPE_POINTS) * 2 * Math.PI) / 100,
      25 + Math.sin((i / MAX_SHAPE_POINTS) * 2 * Math.PI) / 100,
    ]);
    const { call } = shareTool({
      drawings: [
        { id: "drawing:1", source: "user", kind: "polygon", geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } },
      ],
    });
    const out = await call();
    expect(out.url).toBeUndefined();
    expect(out.error).toMatch(/drawing/i);
    expect(out.bytes!).toBeGreaterThan(MAX_SHARE_URL_BYTES);
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
