/**
 * The two guards that stand between the map and the address bar.
 *
 * `useShareHash` writes the map into `location.hash` on every change, which
 * means it runs on every gesture on a page that never reloads. Both ways of
 * getting that wrong are user-visible and neither shows up as an exception:
 *
 *  1. Writing when nothing changed. The map reports its own camera back to the
 *     store after every `moveend` (MapCanvas's `pushViewFromMap`), so a plan
 *     that cannot tell "the same map again" from "a new map" rewrites the URL
 *     forever. The codec's byte-identical re-encode is what makes the cheap
 *     string comparison sound; these tests are what notice if that stops being
 *     true.
 *  2. Writing a link that is too long to survive. `get_share_link` refuses to
 *     hand out a URL over `MAX_SHARE_URL_BYTES`; if the address bar keeps
 *     filling up past that, the human copies out of it the exact link the tool
 *     declined to give them.
 *  3. Downgrading a link by mirroring it. A `v2` link declares the sender's
 *     point-of-interest categories; a page that applied it without fetching
 *     them, or rewrote the bar from what had finished loading, would hand the
 *     recipient back a `v1` link to a map missing everything the sender picked
 *     out. Nothing throws, nothing looks wrong on screen, and the loss only
 *     surfaces when the recipient shares it on. A category that failed to load
 *     is the hard case, and it splits in two: a 5xx or a dropped connection is
 *     a moment on this page and must not shrink the link for everyone
 *     downstream, while a 4xx is the deployment saying the file does not
 *     exist, and a link that kept promising it would only make the next reader
 *     wait for the same 404. The last two tests pin one each.
 */
import { describe, expect, it, vi } from "vitest";
import {
  decodeShareState,
  encodeShareState,
  MAX_SHARE_URL_BYTES,
  SHARE_VERSION_BASE,
  SHARE_VERSION_TIER2,
} from "@/lib/map-tools/share";
import type { ShareState } from "@/lib/map-tools/share";
import { DEFAULT_VIEW, useMapStore, type MapView } from "@/lib/store/map-store";
import { TIER2_INDEX_URL, type Tier2Category } from "@/lib/store/tier2";
import {
  applyShareHash,
  planHashUpdate,
  shareStateChanged,
  shareStateOf,
  type ShareRestoreTarget,
  type ShareStoreSlice,
} from "./share-hash";

const BASE = "http://localhost:3000/";

const state = (patch: Partial<ShareState> = {}): ShareState => ({
  view: DEFAULT_VIEW,
  selection: [],
  drawings: [],
  annotations: [],
  ...patch,
});

const view = (patch: Partial<MapView>): MapView => ({ ...DEFAULT_VIEW, ...patch });

/** A ring of `points` corners around Taipei, closed as GeoJSON requires. */
function bigRing(points: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (2 * Math.PI * i) / points;
    ring.push([121.5175 + 0.05 * Math.cos(angle), 25.0478 + 0.05 * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

const polygon = (points: number): ShareState["drawings"][number] => ({
  source: "user",
  kind: "polygon",
  geometry: { type: "Polygon", coordinates: [bigRing(points)] },
});

describe("planHashUpdate", () => {
  it("plans no write when the map is the one the fragment already describes", () => {
    // The exact case MapCanvas produces on every pan: a new `view` object with
    // the same numbers in it. Nothing about the map changed, so the history
    // entry must not be touched.
    const current = state({ selection: ["mrt:1"] });
    const plan = planHashUpdate(current, BASE, `#${encodeShareState(current)}`);
    expect(plan.hash).toBeNull();
    expect(plan.tooLarge).toBe(false);
  });

  it("compares the fragment with or without its leading #", () => {
    // `location.hash` carries the "#", `encodeShareState` does not. Comparing
    // the two raw would make every single change look like a change.
    const current = state();
    expect(planHashUpdate(current, BASE, encodeShareState(current)).hash).toBeNull();
  });

  it("plans a write when the camera moved, and the fragment restores where to", () => {
    const before = state();
    const after = state({ view: view({ center: [121.6, 25.1], zoom: 15.5 }) });
    const plan = planHashUpdate(after, BASE, `#${encodeShareState(before)}`);
    expect(plan.hash).not.toBeNull();
    const decoded = decodeShareState(plan.hash!);
    expect("error" in decoded).toBe(false);
    expect((decoded as { view: MapView }).view.center).toEqual([121.6, 25.1]);
  });

  it("plans a write when only the selection changed", () => {
    // The camera is the loudest part of the state but not the only shareable
    // one: a link that always carried the map the human is looking at and never
    // what they had picked out on it would be a worse link than none.
    const before = state();
    const after = state({ selection: ["mrt:zhongshan"] });
    const plan = planHashUpdate(after, BASE, `#${encodeShareState(before)}`);
    expect(plan.hash).not.toBeNull();
    const decoded = decodeShareState(plan.hash!);
    expect((decoded as { selection: string[] }).selection).toEqual(["mrt:zhongshan"]);
  });

  it("plans a write when only a drawing was added", () => {
    const before = state();
    const after = state({ drawings: [polygon(5)] });
    const plan = planHashUpdate(after, BASE, `#${encodeShareState(before)}`);
    expect(plan.hash).not.toBeNull();
    expect((decodeShareState(plan.hash!) as { drawings: unknown[] }).drawings).toHaveLength(1);
  });

  it("stops writing once the map outgrows a URL, rather than writing a truncated one", () => {
    // Five 500-point rings, not one: the v3 polyline wire (T-95) buys a factor
    // of about five on coordinates, so a single ring now fits in a link. What
    // nothing caps is how many shapes a map holds — piling rings up is the
    // honest way to outgrow the URL in any wire version.
    const huge = state({ drawings: Array.from({ length: 5 }, () => polygon(500)) });
    const plan = planHashUpdate(huge, BASE, "#v1.previous");
    expect(plan.bytes).toBeGreaterThan(MAX_SHARE_URL_BYTES);
    expect(plan.tooLarge).toBe(true);
    // Null, not the over-long fragment: whatever is in the address bar restores
    // a real map, and it is better than half of this one.
    expect(plan.hash).toBeNull();
  });

  it("plans a write for a map that is merely large", () => {
    // The counterpart to the test above, on the same "#v1.previous" fragment:
    // a shape is not what makes a map unshareable, its size is. Nothing here
    // can latch - planHashUpdate is stateless and sees one map at a time - so
    // the guarantee that deleting the offending shape gives the link back lives
    // in useShareHash, which asks again on the next change (e2e, owned by qa).
    const plan = planHashUpdate(state({ drawings: [polygon(4)] }), BASE, "#v1.previous");
    expect(plan.tooLarge).toBe(false);
    expect(plan.hash).not.toBeNull();
  });

  it("counts the whole URL, not just the fragment", () => {
    // The limit is on what gets pasted into a chat window, and the origin and
    // path are part of that. The same map is shareable from a short URL and not
    // from a long one, so the budget cannot be measured on the hash alone.
    const current = state({ drawings: [polygon(40)] });
    const short = planHashUpdate(current, BASE, "");
    expect(short.tooLarge).toBe(false);

    const overshoot = MAX_SHARE_URL_BYTES - short.bytes + 1;
    const long = planHashUpdate(current, BASE + "p".repeat(overshoot), "");
    expect(long.tooLarge).toBe(true);
    expect(long.hash).toBeNull();
  });

  it("still writes a URL of exactly MAX_SHARE_URL_BYTES", () => {
    // The limit is inclusive, and get_share_link reads it the same way (there,
    // `bytes > MAX_SHARE_URL_BYTES` is the error). Without this case a `>` that
    // becomes a `>=` passes every other test in this file while making the
    // address bar refuse the one link the tool would still hand out.
    const current = state({ drawings: [polygon(40)] });
    const padding = MAX_SHARE_URL_BYTES - planHashUpdate(current, BASE, "").bytes;
    const exact = planHashUpdate(current, BASE + "p".repeat(padding), "");
    expect(exact.bytes).toBe(MAX_SHARE_URL_BYTES);
    expect(exact.tooLarge).toBe(false);
    expect(exact.hash).not.toBeNull();
  });
});

const slice = (patch: Partial<ShareStoreSlice> = {}): ShareStoreSlice => ({
  view: DEFAULT_VIEW,
  selection: [],
  selectionSources: {},
  drawings: [],
  annotations: [],
  tier2Loaded: [],
  tier2Pending: [],
  tier2RestoreFailures: [],
  ...patch,
});

/**
 * The store's writers, recording what a link did to them.
 *
 * One rule of the real store is mimicked rather than stubbed away:
 * `restoreTier2Categories` marks the categories pending *before* it returns,
 * because that is what the mirror reads a moment later. The real registry is
 * held to it in src/lib/store/tier2.test.ts, over a trace of every write it
 * makes; the last test in this file re-checks the seam against the real store.
 */
function recordingStore(initial: Partial<ShareStoreSlice> = {}) {
  const state = slice(initial);
  const restores: Tier2Category[][] = [];
  /** Every write in order, so the flag-first ordering is assertable as a list. */
  const writes: string[] = [];
  let restoredAgentState = false;
  let attributionExplicit = false;
  const target: ShareRestoreTarget = {
    setView: (view) => {
      writes.push("view");
      state.view = view;
    },
    setSelection: (ids, attribution) => {
      writes.push("selection");
      state.selection = ids;
      state.selectionSources =
        attribution && typeof attribution !== "string" ? attribution : state.selectionSources;
    },
    setRestoredAgentState: (value) => {
      writes.push("restoredAgentState");
      restoredAgentState = value;
    },
    setSelectionAttributionExplicit: (value) => {
      writes.push("selectionAttributionExplicit");
      attributionExplicit = value;
    },
    addDrawing: (drawing) => {
      writes.push("drawing");
      state.drawings = [...state.drawings, { ...drawing, id: `drawing:${state.drawings.length + 1}` }];
    },
    addAnnotation: (annotation) => {
      writes.push("annotation");
      state.annotations = [
        ...state.annotations,
        { ...annotation, id: `annotation:${state.annotations.length + 1}` },
      ];
    },
    restoreTier2Categories: (categories) => {
      writes.push("categories");
      restores.push([...categories]);
      state.tier2Pending = [...new Set([...state.tier2Pending, ...categories])]
        .filter((c) => !state.tier2Loaded.includes(c))
        .sort();
      return Promise.resolve();
    },
  };
  return {
    state,
    restores,
    writes,
    target,
    flags: () => ({ restoredAgentState, attributionExplicit }),
  };
}

describe("shareStateOf", () => {
  it("declares the categories in memory and the ones still on their way", () => {
    // The pending half is the whole point. A recipient's bar is rewritten 300ms
    // after the link is applied, when a 500 KB category file is still in
    // flight; writing only `tier2Loaded` would hand them a link to a map
    // without the categories the sender shared - and without the selection that
    // depends on them.
    const shared = shareStateOf(slice({ tier2Loaded: ["cafe"], tier2Pending: ["bakery"] }));
    expect(shared.categories).toEqual(["bakery", "cafe"]);
    expect(encodeShareState(shared).startsWith(`${SHARE_VERSION_TIER2}.`)).toBe(true);
  });

  it("says a category once when it is both loaded and pending", () => {
    // A second restore can re-declare a category that has already arrived, and
    // two links describing the same map have to be the same bytes or the
    // no-change guard above rewrites the bar forever.
    const shared = shareStateOf(slice({ tier2Loaded: ["cafe"], tier2Pending: ["cafe"] }));
    expect(shared.categories).toEqual(["cafe"]);
  });

  it("carries the human's own ids, so the bar and get_share_link say the same thing", () => {
    // The whole point of part two: `get_share_link` writes `su` from
    // `selectionSources`, and until the mirror did too, the address bar
    // rewrote a proven-human map into a `su`-less one 300 ms later — and a
    // `su`-less selection reads as the agent's. The proof of "the same thing"
    // is byte equality with the state the tool encodes, not a shape check.
    const mixed = slice({
      selection: ["mrt:1", "park:2"],
      selectionSources: { "mrt:1": "user", "park:2": "agent" },
    });
    expect(shareStateOf(mixed).userSelected).toEqual(["mrt:1"]);
    expect(encodeShareState(shareStateOf(mixed))).toBe(
      encodeShareState(state({ selection: ["mrt:1", "park:2"], userSelected: ["mrt:1"] })),
    );
  });

  it("says nothing about a selection the agent made alone", () => {
    // Byte identity is the compatibility promise `su` was designed around: a
    // map with no human-selected id encodes to exactly what this codec wrote
    // before the key existed, so every link already in a chat window still
    // means what it meant.
    const agentOnly = slice({
      selection: ["mrt:1"],
      selectionSources: { "mrt:1": "agent" },
    });
    expect(shareStateOf(agentOnly).userSelected).toEqual([]);
    expect(encodeShareState(shareStateOf(agentOnly))).toBe(
      encodeShareState(state({ selection: ["mrt:1"] })),
    );
  });

  it("leaves a map that never touched tier-2 encoding to the bytes it always did", () => {
    // v1, byte for byte: every link already in a chat window stays readable by
    // both sides, and a build that only ever loads the six bundled datasets
    // produces exactly what it did before this field existed.
    const plain = slice({ selection: ["mrt:zhongshan"] });
    expect(shareStateOf(plain).categories).toEqual([]);
    expect(encodeShareState(shareStateOf(plain))).toBe(
      encodeShareState(state({ selection: ["mrt:zhongshan"] })),
    );
    expect(encodeShareState(shareStateOf(plain)).startsWith(`${SHARE_VERSION_BASE}.`)).toBe(true);
  });
});

describe("shareStateChanged", () => {
  it("notices a category being asked for, and arriving", () => {
    // Both edges matter and neither moves the camera or the selection, so
    // without them the bar keeps whatever it last wrote: the sender's own link
    // would never mention the cafes they just loaded, and the recipient's would
    // keep promising a category this page has since given up on.
    const before = slice();
    const asked = slice({ tier2Pending: ["cafe"] });
    const arrived = slice({ tier2Loaded: ["cafe"] });
    expect(shareStateChanged(asked, before)).toBe(true);
    expect(shareStateChanged(arrived, asked)).toBe(true);
  });

  it("ignores a store write that changes nothing a link carries", () => {
    // This runs on every write the store takes - activity entries, WebMCP
    // registration, bounds after each pan - and scheduling an encode for each
    // one is the cost the reference comparison exists to avoid.
    const settled = slice({ tier2Loaded: ["cafe"] });
    expect(shareStateChanged({ ...settled }, settled)).toBe(false);
  });
});

describe("applyShareHash", () => {
  it("fetches the categories a v2 link declares, once, and exactly those", () => {
    const link = encodeShareState(
      state({ selection: ["node/1", "node/2"], categories: ["cafe", "bakery"] }),
    );
    const { state: restored, restores, target } = recordingStore();

    expect(applyShareHash(link, target)).toEqual({ ok: true });

    // Once: this is a fetch of up to 2.5 MB per category, and a second identical
    // restore would re-declare categories a first one had already settled.
    expect(restores).toEqual([["bakery", "cafe"]]);
    // Synchronously pending, before anything else on the page can look: the
    // selection names features nobody has fetched yet, and until the store says
    // those categories are coming, the mirror and `select_features` are both
    // entitled to treat the ids as dead.
    expect(restored.tier2Pending).toEqual(["bakery", "cafe"]);
    expect(restored.selection).toEqual(["node/1", "node/2"]);
  });

  it("asks for nothing tier-2 on a v1 link, and restores it as it always did", () => {
    const link = encodeShareState(
      state({ view: view({ center: [121.6, 25.1], zoom: 15.5 }), selection: ["mrt:1"] }),
    );
    const { state: restored, restores, target } = recordingStore();

    expect(applyShareHash(link, target)).toEqual({ ok: true });

    expect(restores).toEqual([]);
    expect(restored.tier2Pending).toEqual([]);
    expect(restored.view.center).toEqual([121.6, 25.1]);
    expect(restored.selection).toEqual(["mrt:1"]);
    // And the bar this page writes back is the same link, to the byte: an old
    // link opened on this build is not quietly upgraded either.
    expect(encodeShareState(shareStateOf(restored))).toBe(link);
  });

  it("hands back the reason a link was refused instead of half-applying it", () => {
    const { state: restored, restores, target } = recordingStore();
    const result = applyShareHash("#v9.nonsense", target);

    expect(result.ok).toBe(false);
    expect(restores).toEqual([]);
    // The map keeps its default view rather than a camera read out of a
    // fragment this build could not parse.
    expect(restored.view).toBe(DEFAULT_VIEW);
    expect(restored.selection).toEqual([]);
  });
});

describe("what a restored link states about who was here", () => {
  it("writes both flags before it writes a single thing the map shows", () => {
    // The ordering is the contract (`src/lib/awaken/index.ts`): every
    // subscriber sees every write, so a camera or a shape landing while the
    // page still reports "idle" is a restored map shown for a frame in human
    // chrome, with the agent panels snapping in behind it. It is also what
    // keeps a *future* restore writer from being read as an agent arriving.
    const link = encodeShareState(
      state({ selection: ["node/1"], drawings: [{ ...polygon(4), source: "agent" }] }),
    );
    const { writes } = (() => {
      const store = recordingStore();
      expect(applyShareHash(link, store.target)).toEqual({ ok: true });
      return store;
    })();
    expect(writes.slice(0, 2).sort()).toEqual([
      "restoredAgentState",
      "selectionAttributionExplicit",
    ]);
    expect(writes.slice(2)).toEqual(["view", "selection", "drawing"]);
  });

  it("records the link's `su` ids as the human's, and claims nothing about the rest", () => {
    // §2.5's razor: the record says what it was told. The ids outside `su` are
    // left unattributed rather than stamped "agent" — that reading is an
    // inference, and `selectionAttributionExplicit` is where a surface takes
    // it knowingly.
    const link = encodeShareState(
      state({ selection: ["mrt:1", "park:2"], userSelected: ["mrt:1"] }),
    );
    const store = recordingStore();
    expect(applyShareHash(link, store.target)).toEqual({ ok: true });

    expect(store.state.selectionSources).toEqual({ "mrt:1": "user" });
    expect(store.flags()).toEqual({ restoredAgentState: true, attributionExplicit: true });

    // And the recipient's own bar re-encodes to the link they were sent, `su`
    // and all: the round trip that used to lose the sender's proof.
    expect(encodeShareState(shareStateOf(store.state))).toBe(link);
  });

  it("keeps a map the human selected alone out of agent chrome entirely", () => {
    // The one selection that is evidence of no agent at all: attributed, and
    // attributed entirely to the person. A page that woke up for this link
    // would be announcing an agent that never existed.
    const link = encodeShareState(
      state({ selection: ["mrt:1"], userSelected: ["mrt:1"] }),
    );
    const store = recordingStore();
    expect(applyShareHash(link, store.target)).toEqual({ ok: true });

    expect(store.flags()).toEqual({ restoredAgentState: false, attributionExplicit: true });
    expect(encodeShareState(shareStateOf(store.state))).toBe(link);
  });

  it("hedges a link that stated nothing, and stays teal about it", () => {
    // Every `su`-less link is one indistinguishable wire state — legacy, or
    // all-agent from the new encoder — so the page presumes agent (the safe
    // direction, Ruling 3) and knows it is presuming.
    const link = encodeShareState(state({ selection: ["mrt:1"] }));
    const store = recordingStore();
    expect(applyShareHash(link, store.target)).toEqual({ ok: true });

    expect(store.state.selectionSources).toEqual({});
    expect(store.flags()).toEqual({ restoredAgentState: true, attributionExplicit: false });
    // Nothing to say, so nothing said: the bar the recipient re-writes is the
    // same `su`-less link, not one that invents an attribution.
    expect(encodeShareState(shareStateOf(store.state))).toBe(link);
  });
});

describe("a v2 link, applied and mirrored back", () => {
  it("leaves the recipient's address bar on the link they were sent", async () => {
    // The real store, because this is the seam the release gate is about: the
    // page hands `useMapStore.getState()` to both halves, so a category has to
    // be pending the instant the mirror looks - not when the file lands.
    // Nothing is fetched here; a relative URL does not resolve under node, so
    // the load fails immediately - with a TypeError, which is the same shape of
    // failure as an offline browser or a 5xx: transient. What matters is what is
    // true before it fails, and what is still true after.
    const sent = encodeShareState(state({ selection: ["node/1"], categories: ["cafe"] }));
    try {
      expect(applyShareHash(sent, useMapStore.getState())).toEqual({ ok: true });

      // No change to write: the v2 hash the recipient opened stays in their bar,
      // still carrying the sender's categories. This is the silent downgrade.
      expect(planHashUpdate(shareStateOf(useMapStore.getState()), BASE, `#${sent}`).hash).toBeNull();

      await vi.waitFor(() =>
        expect(useMapStore.getState().tier2RestoreFailures).toHaveLength(1),
      );
      // What the page tells the human, named by category (ShareRestoreNotice).
      expect(useMapStore.getState().tier2RestoreFailures[0].category).toBe("cafe");
      expect(useMapStore.getState().tier2RestoreFailures[0].permanent).toBe(false);

      // And the bar still says v2 once the failure has settled, because this
      // failure was a moment on this page and not a fact about the data. The
      // link keeps declaring "cafe", so the next page to open it fetches the
      // file again. Dropping it here would hand the next reader a link whose
      // `node/1` belongs to no declared category - an id nothing downstream
      // will ever fetch - on the strength of one bad second here.
      const settled = planHashUpdate(shareStateOf(useMapStore.getState()), BASE, `#${sent}`);
      expect(settled.hash).toBeNull();
    } finally {
      useMapStore.setState({
        view: DEFAULT_VIEW,
        selection: [],
        tier2Pending: [],
        tier2RestoreFailures: [],
      });
    }
  });

  it("falls back to v1 once a category is known not to be coming", async () => {
    // The other half of the same rule, and the reason the assertion above is
    // not enough on its own: a permanent failure *must* shrink the link. The
    // index is served and lists the category, and the category file itself
    // 404s - the deployment saying this file does not exist. A link that kept
    // declaring it would make every reader downstream wait for the same 404.
    //
    // The 404 is on the file rather than on the index on purpose: a missing
    // index latches "this deployment has no tier-2 data" inside the registry
    // for the life of the module, which would decide the outcome of any test
    // that ran after this one.
    const sent = encodeShareState(state({ selection: ["node/1"], categories: ["cafe"] }));
    const index = JSON.stringify({
      categories: [{ category: "cafe", file: "cafe.geojson", count: 1 }],
    });
    vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
      Promise.resolve(
        String(input) === TIER2_INDEX_URL
          ? new Response(index, { status: 200 })
          : new Response("", { status: 404, statusText: "Not Found" }),
      ),
    );
    try {
      expect(applyShareHash(sent, useMapStore.getState())).toEqual({ ok: true });

      await vi.waitFor(() => expect(useMapStore.getState().tier2RestoreFailures).toHaveLength(1));
      expect(useMapStore.getState().tier2RestoreFailures[0].category).toBe("cafe");
      expect(useMapStore.getState().tier2RestoreFailures[0].permanent).toBe(true);

      const settled = planHashUpdate(shareStateOf(useMapStore.getState()), BASE, `#${sent}`);
      // A write, and a shorter link than the one that arrived: the categories
      // are gone and with them the version marker.
      expect(settled.hash).not.toBeNull();
      expect(settled.hash!.startsWith(`${SHARE_VERSION_BASE}.`)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      useMapStore.setState({
        view: DEFAULT_VIEW,
        selection: [],
        tier2Pending: [],
        tier2RestoreFailures: [],
        tier2Manifest: null,
      });
    }
  });
});
