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

  it("takes a per-id record as the whole truth, replacing what it does not restate", () => {
    for (const [name, store] of adapters()) {
      // The second shape of the write, and the reason it cannot be folded into
      // the first: a caller that hands over a record is describing the whole
      // selection, not adding to it. `select_features` with `replace: true`
      // and the share-link restore both chose every id in the map they are
      // writing, so a tag left over from the selection they replaced would
      // outlive the decision that made it.
      store.setSelection(["osm:node:2", "osm:way:10"], "user");
      store.setSelection(["osm:node:2", "osm:way:10", "osm:node:3"], {
        "osm:node:2": "agent",
      });
      expect(store.getSelectionSources(), name).toEqual({ "osm:node:2": "agent" });
    }
  });

  it("restores a link's `su` as the human's, and drops what this page thought before", () => {
    for (const [name, store] of adapters()) {
      // The restore path (`applyShareHash` via `restoredSelectionSources`).
      // Two facts in one write. The link's statement is recorded, because
      // without it the recipient's address bar re-encodes the selection with
      // no `su` and a proven-human map reads as the agent's on reload. And a
      // click this page made before the link landed is not carried over: the
      // restore replaced the map, so the wire's statement is the fact about
      // it, not this page's memory of a map that is gone.
      store.setSelection(["osm:node:2"], "user");
      store.setSelection(["osm:node:2", "osm:way:10"], { "osm:way:10": "user" });
      expect(store.getSelectionSources(), name).toEqual({ "osm:way:10": "user" });
    }
  });

  it("ignores a stated source for an id that is not selected", () => {
    for (const [name, store] of adapters()) {
      // The same intersect-only rule `su` obeys on the wire: the record can
      // only ever describe what the map is showing, so a hand-edited link -
      // or a caller building a record from a stale list - cannot leave a
      // provenance entry behind for a feature nobody selected.
      store.setSelection(["osm:node:2"], { "osm:node:2": "user", "osm:way:10": "agent" });
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

/**
 * The evidence the restored chrome's *copy* is gated on. Its sibling above
 * decides what the page is; this decides what the page may claim about who
 * selected the beads on it, and the whole point of it being store state is
 * that the claim is made by a surface rendered long after the link is gone.
 */
describe("selectionAttributionExplicit", () => {
  beforeEach(() => {
    useMapStore.setState({
      selectionAttributionExplicit: false,
      selection: [],
      selectionSources: {},
    });
  });

  it("is off on a page opened without a link: nothing has stated anything yet", () => {
    // False is not "the link said no human selected these" - it is "no link
    // said anything", which is why the copy it gates hedges rather than
    // asserting the agent.
    expect(useMapStore.getState().selectionAttributionExplicit).toBe(false);
  });

  it("takes the link's statement in both directions, so evidence cannot outlive its link", () => {
    // `applyShareHash` writes it from `selectionAttributionExplicit(decoded)`
    // unconditionally, false included. A setter that only ever turned it on
    // would let a `su`-carrying link license "selected by the agent" for the
    // beads of a `su`-less one restored after it.
    const store = useMapStore.getState();
    store.setSelectionAttributionExplicit(true);
    expect(useMapStore.getState().selectionAttributionExplicit).toBe(true);
    store.setSelectionAttributionExplicit(false);
    expect(useMapStore.getState().selectionAttributionExplicit).toBe(false);
  });

  it("is settable on its own, ahead of the content the restore is about to write", () => {
    // It rides the flag-first block (src/lib/awaken/index.ts): both bits land
    // before the view, the selection and the shapes, so no frame of the
    // restored map is ever rendered with the wrong sentence under it.
    useMapStore.setState({ restoredAgentState: false, selection: [], drawings: [] });
    const store = useMapStore.getState();
    store.setRestoredAgentState(true);
    store.setSelectionAttributionExplicit(true);
    expect(useMapStore.getState()).toMatchObject({
      restoredAgentState: true,
      selectionAttributionExplicit: true,
      selection: [],
      drawings: [],
    });
  });

  it("keeps describing the restore when the agent selects live, because the record wins", () => {
    // The reset rule, and why there is no reset. A live write records its own
    // per-id source, and a record is stronger evidence than a link's
    // statement: copy asks `selectionSources` first, so a later selection
    // cannot make the link's statement wrong. Clearing the bit here would
    // instead hedge the restored beads whose attribution the sender proved.
    const store = useMapStore.getState();
    store.setSelectionAttributionExplicit(true);
    // The restore: `su` named one of the two ids; the other is the sender's
    // agent selection, recorded nowhere but implied by the statement.
    store.setSelection(["osm:node:2", "osm:way:10"], { "osm:node:2": "user" });

    store.setSelection(["osm:node:2", "osm:way:10", "osm:node:3"], "agent");
    expect(useMapStore.getState().selectionAttributionExplicit).toBe(true);
    // Three ids, three different answers: two recorded (the record answers),
    // one still unrecorded (the bit answers, and says the sender attributed
    // it to their agent).
    expect(useMapStore.getState().selectionSources).toEqual({
      "osm:node:2": "user",
      "osm:node:3": "agent",
    });
  });
});

/**
 * The flag the tool layer's place lookup is gated on (T-103). It is store state
 * rather than a derived `getFeatures().length > 0` for one reason: a page whose
 * data is on the way and a page whose data is genuinely empty look identical
 * from the features, and only one of them may be told to ask again.
 */
describe("base data readiness", () => {
  beforeEach(() => {
    useMapStore.setState({ features: [], baseDataLoaded: false });
  });

  it("starts false, because a page is mounted before its 614 KB has arrived", () => {
    expect(zustandToolStore.isBaseDataLoaded()).toBe(false);
  });

  it("is closed by the same write that delivers the features, never a tick later", () => {
    // Every subscriber sees each store write. A page that was briefly "has
    // features, still loading" would be a page in which a name lookup is
    // refused while the answer is already sitting in the store.
    useMapStore.getState().setFeatures([]);
    const { features, baseDataLoaded } = useMapStore.getState();
    expect({ features, baseDataLoaded }).toEqual({ features: [], baseDataLoaded: true });
  });

  it("counts a loader that found nothing as loaded, so an empty page answers instead of stalling", () => {
    // All six datasets 404 is a real deployment state (`useFeatureData` swallows
    // each failure and hands over the empty flatten). That page has no places,
    // permanently — telling every caller to ask again would be a lie that never
    // resolves.
    useMapStore.getState().setFeatures([]);
    expect(zustandToolStore.isBaseDataLoaded()).toBe(true);
  });

  it("says the in-memory adapter is ready exactly when it was given the page's data", () => {
    // What the two constructor shapes mean, pinned so the tool tests can rely
    // on them: features in hand is a loader that returned, no features is the
    // window before it did, and the explicit flag describes the third case.
    expect(createMemoryToolStore({ features: [] }).isBaseDataLoaded()).toBe(true);
    expect(createMemoryToolStore().isBaseDataLoaded()).toBe(false);
    expect(createMemoryToolStore({ baseDataLoaded: true }).isBaseDataLoaded()).toBe(true);
  });
});
