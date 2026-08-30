/**
 * The activity slice is the one piece of store state the page renders but no
 * tool ever reads back, so nothing else would notice if it drifted from the
 * in-memory adapter the tool tests use. These tests pin the two of them
 * together, on the store the app actually ships.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ACTIVITY_LIMIT,
  createMemoryToolStore,
  useMapStore,
  zustandToolStore,
  type ActivityEntry,
  type MapToolStore,
} from "./map-store";

const entry = (n: number): Omit<ActivityEntry, "seq" | "at"> => ({
  tool: "get_map_state",
  summary: `call ${n}`,
  readOnly: true,
  ok: true,
});

describe("activity slice", () => {
  beforeEach(() => {
    useMapStore.setState({ activity: [], activitySeq: 1 });
  });

  it("keeps calls newest last, so the feed reads top-down in call order", () => {
    zustandToolStore.recordActivity(entry(1));
    zustandToolStore.recordActivity(entry(2));
    expect(useMapStore.getState().activity.map((e) => e.summary)).toEqual(["call 1", "call 2"]);
    expect(useMapStore.getState().activity.map((e) => e.seq)).toEqual([1, 2]);
  });

  it(`drops the oldest past ${ACTIVITY_LIMIT} but never restarts seq`, () => {
    // seq is what the UI keys rows on and what tells a reader how many calls
    // the agent has made; reusing it after the cap would make React reuse rows.
    const calls = ACTIVITY_LIMIT + 3;
    for (let i = 1; i <= calls; i++) zustandToolStore.recordActivity(entry(i));

    const { activity, activitySeq } = useMapStore.getState();
    expect(activity).toHaveLength(ACTIVITY_LIMIT);
    expect(activity[0].summary).toBe(`call ${calls - ACTIVITY_LIMIT + 1}`);
    expect(activity.map((e) => e.seq)).toEqual(
      activity.map((_e, i) => calls - ACTIVITY_LIMIT + 1 + i),
    );
    expect(activitySeq).toBe(calls + 1);
  });

  it("stores exactly what the tool layer reported, plus seq and a timestamp", () => {
    const before = Date.now();
    zustandToolStore.recordActivity({
      tool: "draw_shape",
      summary: "Circle, 800 m → drawing:1",
      readOnly: false,
      ok: true,
      refIds: ["drawing:1"],
    });
    const [row] = useMapStore.getState().activity;
    expect(row).toMatchObject({
      seq: 1,
      tool: "draw_shape",
      summary: "Circle, 800 m → drawing:1",
      readOnly: false,
      ok: true,
      refIds: ["drawing:1"],
    });
    expect(row.at).toBeGreaterThanOrEqual(before);
  });

  it("behaves the same as the in-memory adapter the tool tests assert against", () => {
    // If these two ever diverge, every activity test in map-tools would be
    // testing something the app does not do.
    const memory = createMemoryToolStore();
    for (let i = 1; i <= ACTIVITY_LIMIT + 2; i++) {
      zustandToolStore.recordActivity(entry(i));
      memory.recordActivity(entry(i));
    }
    // Timestamps are wall-clock and may differ by a millisecond; everything
    // else about the two rows has to be identical.
    const strip = (rows: readonly ActivityEntry[]) => rows.map((row) => ({ ...row, at: 0 }));
    expect(strip(memory.getActivity())).toEqual(strip(useMapStore.getState().activity));
  });
});

/**
 * Who selected what. The record exists so the map can say "the agent picked
 * these five, you picked that one" without ever guessing — which means the
 * interesting cases are the ones where it has to stay silent.
 */
describe("selection provenance", () => {
  beforeEach(() => {
    useMapStore.setState({ selection: [], selectionSources: {} });
  });

  /** Both adapters, so the tool tests and the app can never drift apart. */
  const adapters = (): [string, MapToolStore][] => [
    ["zustand", zustandToolStore],
    ["memory", createMemoryToolStore()],
  ];

  it("records who added an id, and keeps it while the id stays selected", () => {
    for (const [name, store] of adapters()) {
      store.setSelection(["osm:node:2"], "user");
      store.setSelection(["osm:node:2", "osm:way:10"], "agent");
      // The human's own click survives the agent selecting around it: the
      // second call added osm:way:10 and merely kept osm:node:2. Overwriting
      // here is how "3 selected by the agent · 2 by you" would quietly become
      // "5 selected by the agent".
      expect(store.getSelectionSources(), name).toEqual({
        "osm:node:2": "user",
        "osm:way:10": "agent",
      });
    }
  });

  it("records nothing for a selection whose origin it was not told", () => {
    for (const [name, store] of adapters()) {
      // This is the share-link restore path: the ids arrive with no claim
      // about who chose them, and inventing one is exactly what the hedged
      // "from a shared link" copy exists to avoid.
      store.setSelection(["osm:node:2", "osm:way:10"]);
      expect(store.getSelectionSources(), name).toEqual({});
      // A later agent call that keeps them does not retro-claim them either.
      store.setSelection(["osm:node:2", "osm:way:10", "osm:node:3"], "agent");
      expect(store.getSelectionSources(), name).toEqual({ "osm:node:3": "agent" });
    }
  });

  it("forgets an id the moment it leaves the selection", () => {
    for (const [name, store] of adapters()) {
      store.setSelection(["osm:node:2", "osm:way:10"], "agent");
      store.setSelection(["osm:way:10"], "agent");
      expect(store.getSelectionSources(), name).toEqual({ "osm:way:10": "agent" });
      // Nothing selected, nothing claimed: the record can never name a feature
      // the map is not highlighting, which is what would let a share link's
      // `su` carry an id its `s` does not.
      store.setSelection([]);
      expect(store.getSelectionSources(), name).toEqual({});
    }
  });

  it("re-selecting after a clear is a new decision, attributed to whoever made it", () => {
    for (const [name, store] of adapters()) {
      store.setSelection(["osm:node:2"], "agent");
      store.setSelection([]);
      store.setSelection(["osm:node:2"], "user");
      expect(store.getSelectionSources(), name).toEqual({ "osm:node:2": "user" });
    }
  });
});

/**
 * The flag the awakening reads. The point of it being a plain store field is
 * that the module watching it never has to know a link was involved.
 */
describe("restoredAgentState", () => {
  it("is off on a page nobody opened with a link", () => {
    useMapStore.setState({ restoredAgentState: false });
    expect(useMapStore.getState().restoredAgentState).toBe(false);
  });

  it("is a one-write flag the restore path can put ahead of everything else", () => {
    // Flag-first is the ordering contract (see src/lib/awaken/index.ts): this
    // has to be settable on its own, before the view, the selection or a
    // single shape has landed.
    useMapStore.setState({ restoredAgentState: false, selection: [], drawings: [] });
    useMapStore.getState().setRestoredAgentState(true);
    expect(useMapStore.getState()).toMatchObject({
      restoredAgentState: true,
      selection: [],
      drawings: [],
    });
  });
});
