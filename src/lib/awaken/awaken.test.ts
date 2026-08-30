/**
 * The Awakening's trigger — the eleven orderings.
 *
 * The awakening is the one moment GlassMap tells a human "an agent is here",
 * and it is worth nothing unless it is true. Two failures are unacceptable and
 * neither is visible in a screenshot:
 *
 *  - **A story that did not happen.** Opening a shared link, remounting a
 *    component, or a person drawing on their own map must never announce an
 *    arrival. A page that cried agent when none was there would make the badge
 *    it raises meaningless.
 *  - **A story that never happens.** The first agent call must be announced
 *    whatever else the page is doing at the time, including mid-restore — an
 *    agent that took over silently is the whole problem this product exists to
 *    fix.
 *
 * So the tests below are ordering tests: mount, restore writes and the first
 * live call, in every order they can arrive, plus the two paths that write
 * agent activity from outside the tool layer. They run against the real
 * Zustand store with no React anywhere, because the trigger's correctness is a
 * property of store writes, and asserting it through a renderer would only
 * test the renderer.
 *
 * The restore sequence is simulated here rather than imported from
 * `components/share-hash.ts`: `applyShareHash` does not write the flag yet (it
 * is the UI task that consumes this module), and these tests are the contract
 * it has to implement — `restoreWrites` below is that sequence, written out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AWAKEN_MAX_MS,
  AWAKEN_MS,
  AWAKEN_RM_MS,
  bootMode,
  createAwaken,
  isAgentState,
  resetAwakenPlayed,
  type AwakenMode,
} from "./index";
import { useMapStore, type ActivityEntry } from "@/lib/store/map-store";
import {
  decodeShareState,
  encodeShareState,
  restoredAgentStateOf,
  type DecodedShareState,
  type ShareState,
} from "@/lib/map-tools/share";

const VIEW = { center: [121.5375, 25.0325] as [number, number], zoom: 14, bearing: 0, pitch: 0 };

/** What the tool layer records for a real call; `withActivity`'s shape. */
const agentCall = (tool = "find_features"): Omit<ActivityEntry, "seq" | "at"> => ({
  tool,
  summary: "3 parks within 1 km",
  readOnly: true,
  ok: true,
});

/** A link, through the real codec — decoded exactly as a recipient sees it. */
function link(state: ShareState): DecodedShareState {
  const decoded = decodeShareState(encodeShareState(state));
  if ("error" in decoded) throw new Error(decoded.error);
  return decoded;
}

const AGENT_DRAWING = {
  source: "agent" as const,
  kind: "circle" as const,
  geometry: { type: "Polygon" as const, coordinates: [[]] },
  center: [121.5436, 25.0334] as [number, number],
  radius_m: 800,
};

const USER_DRAWING = { ...AGENT_DRAWING, source: "user" as const };

/** Agent work, proven on the wire: the drawing carries `source: "agent"`. */
const AGENT_LINK = link({
  view: VIEW,
  selection: [],
  drawings: [AGENT_DRAWING],
  annotations: [],
});

/**
 * The legacy shape (T9): a selection and nothing else, from a build that never
 * wrote `su`. Presumed agent — see `restoredAgentStateOf`.
 */
const LEGACY_SELECTION_LINK = link({
  view: VIEW,
  selection: ["osm:node:2", "osm:way:10"],
  drawings: [],
  annotations: [],
});

/** A map a person made alone: their own shape, their own clicks, attributed. */
const HUMAN_LINK = link({
  view: VIEW,
  selection: ["osm:node:2"],
  userSelected: ["osm:node:2"],
  drawings: [USER_DRAWING],
  annotations: [],
});

/**
 * The store writes `applyShareHash` performs, in the order it performs them —
 * with the flag write's position as the variable, because that position is the
 * contract (see the module header). `flagFirst: false` is not a supported
 * ordering; it is here so the tests can show what it costs.
 */
function restoreWrites(decoded: DecodedShareState, { flagFirst = true } = {}) {
  const store = useMapStore.getState();
  const flag = () => store.setRestoredAgentState(restoredAgentStateOf(decoded));
  if (flagFirst) flag();
  store.setView(decoded.view);
  store.setSelection(decoded.selection);
  for (const drawing of decoded.drawings) store.addDrawing(drawing);
  for (const annotation of decoded.annotations) store.addAnnotation(annotation);
  if (!flagFirst) flag();
}

/** A controller plus every mode it has announced, in order. */
function watch() {
  const modes: AwakenMode[] = [];
  const controller = createAwaken({
    store: useMapStore,
    onMode: (mode) => modes.push(mode),
  });
  return { ...controller, modes };
}

beforeEach(() => {
  resetAwakenPlayed();
  useMapStore.setState({
    activity: [],
    activitySeq: 1,
    restoredAgentState: false,
    selection: [],
    selectionSources: {},
    drawings: [],
    annotations: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("awaken: the mode a page is in", () => {
  it("is agent state whenever there is agent work, from either source", () => {
    // The two are deliberately not the same question: one says an agent is
    // acting here, the other that one acted before this link was sent. Both
    // mean the map on screen is not purely human work.
    expect(isAgentState({ activity: [], restoredAgentState: false })).toBe(false);
    expect(isAgentState({ activity: [1], restoredAgentState: false })).toBe(true);
    expect(isAgentState({ activity: [], restoredAgentState: true })).toBe(true);
  });

  it("boots into the end state when the agent work is already there", () => {
    // History, not news. Both cases are real: a link applied before the
    // component mounted, and a remount after the agent has been working.
    expect(bootMode({ activity: [], restoredAgentState: false })).toBe("human");
    expect(bootMode({ activity: [], restoredAgentState: true })).toBe("awake");
    expect(bootMode({ activity: [1], restoredAgentState: false })).toBe("awake");
  });

  it("declares a transition the calm map can absorb", () => {
    // The ceiling is the same law FX_MAX_MS states for effects; the
    // choreography has to land inside it, and reduced motion far sooner.
    expect(AWAKEN_MS).toBeLessThanOrEqual(AWAKEN_MAX_MS);
    expect(AWAKEN_RM_MS).toBeLessThan(AWAKEN_MS);
  });
});

describe("awaken trigger: the eleven orderings", () => {
  it("T1 · mount, then the first live call: plays exactly once", () => {
    const w = watch();
    expect(w.modes).toEqual(["human"]);

    useMapStore.getState().recordActivity(agentCall());
    expect(w.modes).toEqual(["human", "waking"]);
    expect(w.mode()).toBe("waking");

    w.completeWaking();
    expect(w.modes).toEqual(["human", "waking", "awake"]);
  });

  it("T2 · a second and third call add nothing: the story is an arrival, not an effect", () => {
    // Every call already gets its own feed row and its own FX. The awakening
    // is the one thing that says "an agent is here now", and that is true once.
    const w = watch();
    useMapStore.getState().recordActivity(agentCall());
    w.completeWaking();
    useMapStore.getState().recordActivity(agentCall("select_features"));
    useMapStore.getState().recordActivity(agentCall("draw_shape"));
    expect(w.modes).toEqual(["human", "waking", "awake"]);
  });

  it("T3 · mount, then a restore carrying agent work: lands awake without a story", () => {
    // The agent worked on the sender's map, not on this one. Announcing an
    // arrival here would credit an agent that is not present.
    const w = watch();
    expect(w.modes).toEqual(["human"]);

    restoreWrites(AGENT_LINK);
    expect(w.modes).toEqual(["human", "awake"]);
    expect(w.mode()).toBe("awake");
  });

  it("T4 · a restore that finished before mount: boots awake, no story", () => {
    // The real ordering on a shared link: the store is populated from the hash
    // before the component that watches it exists.
    restoreWrites(AGENT_LINK);
    const w = watch();
    expect(w.modes).toEqual(["awake"]);
    expect(w.mode()).toBe("awake");
  });

  it("T5 · subscribing in the middle of a restore: still no story", () => {
    // Flag-first means the very first write already says "restored agent
    // state", so a controller that starts anywhere after it boots awake and
    // reads the remaining writes as the restore they are.
    const store = useMapStore.getState();
    store.setRestoredAgentState(restoredAgentStateOf(AGENT_LINK));

    const w = watch();
    expect(w.modes).toEqual(["awake"]);

    store.setView(AGENT_LINK.view);
    store.setSelection(AGENT_LINK.selection);
    for (const drawing of AGENT_LINK.drawings) store.addDrawing(drawing);
    expect(w.modes).toEqual(["awake"]);
  });

  it("T6 · a remount never replays it, and never swallows a story it has not played", () => {
    // The guard is module state because React remounts components; a page that
    // replayed the announcement on a parent re-render would claim a second
    // arrival that never happened.
    const first = watch();
    first.teardown();
    expect(first.modes).toEqual(["human"]);

    const second = watch();
    useMapStore.getState().recordActivity(agentCall());
    second.completeWaking();
    expect(second.modes).toEqual(["human", "waking", "awake"]);

    second.teardown();
    const third = watch();
    expect(third.modes).toEqual(["awake"]);
    useMapStore.getState().recordActivity(agentCall("annotate"));
    expect(third.modes).toEqual(["awake"]);
  });

  it("T7 · a restored map with no agent work still wakes for its first live call", () => {
    // A person shared their own map; an agent then picks it up. This is a real
    // arrival, and the restore must not have used the story up.
    expect(restoredAgentStateOf(HUMAN_LINK)).toBe(false);
    restoreWrites(HUMAN_LINK);

    const w = watch();
    expect(w.modes).toEqual(["human"]);

    useMapStore.getState().recordActivity(agentCall());
    expect(w.modes).toEqual(["human", "waking"]);
  });

  it("T8 · a person drawing, pinning and selecting on their own map wakes nothing", () => {
    // Human writes touch drawings, annotations and the selection, never
    // `activity` — the map stays a human map, however busy it gets.
    const w = watch();
    const store = useMapStore.getState();
    store.addDrawing({ ...USER_DRAWING });
    store.addAnnotation({ source: "user", at: VIEW.center, note: "my desk" });
    store.setSelection(["osm:node:2"], "user");
    expect(w.modes).toEqual(["human"]);
    expect(w.mode()).toBe("human");
  });

  it("T9 · a legacy selection-only link boots awake on the presumption, silently", () => {
    // No `su`, so the wire cannot say who selected these ids, and the recorded
    // presumption is agent (`restoredAgentStateOf`). The page therefore opens
    // in agent chrome — but presumed evidence is still not an arrival, so
    // nothing is narrated and nothing claims an agent is here now.
    expect(LEGACY_SELECTION_LINK.userSelected).toBeUndefined();
    expect(restoredAgentStateOf(LEGACY_SELECTION_LINK)).toBe(true);

    restoreWrites(LEGACY_SELECTION_LINK);
    const w = watch();
    expect(w.modes).toEqual(["awake"]);
    expect(w.mode()).toBe("awake");
  });

  it("T10 · the flag's position in the restore sequence: silent either way, human-flash only if last", () => {
    // Sufficiency first: no restore write can be read as an arrival wherever
    // the flag sits, because nothing in the sequence touches `activity`.
    const late = watch();
    restoreWrites(AGENT_LINK, { flagFirst: false });
    expect(late.modes).toEqual(["human", "awake"]);
    expect(late.modes).not.toContain("waking");

    // And the reason the ordering is still a contract: written last, every
    // content write lands while the page still reports human mode, so the
    // restored map is rendered in human chrome and the agent chrome snaps in
    // afterwards. Flag-first collapses that window to nothing.
    const humanWindowWrites = useMapStore.getState().drawings.length;
    expect(humanWindowWrites).toBeGreaterThan(0);
    expect(late.mode()).toBe("awake");

    useMapStore.setState({ restoredAgentState: false, drawings: [] });
    const early = watch();
    restoreWrites(AGENT_LINK, { flagFirst: true });
    // First write, first notification: nothing after it is seen in human mode.
    expect(early.modes).toEqual(["human", "awake"]);
    expect(early.modes.indexOf("awake")).toBe(1);
  });

  it("T11 · an agent submitting the note form is a first call; a human submitting it is not", () => {
    // `AddNoteForm` records its own activity when `agentInvoked` is true,
    // because a declarative form never goes through `createMapTools`. That
    // write is the crossing for an agent whose first act is pinning a note —
    // an implementer who routed around this caller would kill it silently.
    const w = watch();
    const store = useMapStore.getState();

    // The human's submission: the note is added, no activity is recorded.
    store.addAnnotation({ source: "user", at: VIEW.center, note: "meet here" });
    expect(w.modes).toEqual(["human"]);

    // The agent's submission, in the form's own words.
    store.addAnnotation({ source: "agent", at: VIEW.center, note: "Nearest supermarket" });
    store.recordActivity({
      tool: "add_note",
      summary: "Pinned “Nearest supermarket” → annotation:2",
      readOnly: false,
      ok: true,
      refIds: ["annotation:2"],
    });
    expect(w.modes).toEqual(["human", "waking"]);

    w.completeWaking();
    expect(w.modes).toEqual(["human", "waking", "awake"]);
  });
});

describe("awaken lifecycle", () => {
  it("finishes waking on its own if the choreography never reports back", () => {
    // The calm map is law. A UI bug must cost the animation, never leave the
    // page stranded between two chromes with half its controls missing.
    vi.useFakeTimers();
    const w = watch();
    useMapStore.getState().recordActivity(agentCall());
    expect(w.mode()).toBe("waking");

    vi.advanceTimersByTime(AWAKEN_MAX_MS - 1);
    expect(w.mode()).toBe("waking");
    vi.advanceTimersByTime(1);
    expect(w.modes).toEqual(["human", "waking", "awake"]);
  });

  it("plays once per document, even if the store's agent evidence comes and goes", () => {
    // Defence in depth, and deliberately kept: today `bootMode` alone would
    // cover every remount, because `activity` only ever grows and
    // `restoredAgentState` is only ever turned on — so a page can never fall
    // back to human mode and cross a second time. The module-level flag is
    // what makes "once" a property of the awakening rather than a property of
    // that growth pattern: whoever later trims the feed, resets a session or
    // mounts a second watcher gets no second arrival.
    const first = watch();
    useMapStore.getState().recordActivity(agentCall());
    first.completeWaking();
    first.teardown();

    useMapStore.setState({ activity: [], activitySeq: 1 });
    const second = watch();
    expect(second.modes).toEqual(["human"]);

    useMapStore.getState().recordActivity(agentCall("draw_shape"));
    expect(second.modes).toEqual(["human", "awake"]);
    expect(second.modes).not.toContain("waking");
  });

  it("completes once, and only out of waking", () => {
    // The kill switch and reduced motion both reach the end state early and
    // call this; calling it twice, or before the story starts, must not
    // announce anything.
    const w = watch();
    w.completeWaking();
    expect(w.modes).toEqual(["human"]);

    useMapStore.getState().recordActivity(agentCall());
    w.completeWaking();
    w.completeWaking();
    expect(w.modes).toEqual(["human", "waking", "awake"]);
  });

  it("lands on a resting mode when torn down mid-story, and stops listening", () => {
    // `body[data-awaken]` outlives the component; leaving it at "waking" would
    // leave the page half-dressed with nothing left to finish it.
    vi.useFakeTimers();
    const w = watch();
    useMapStore.getState().recordActivity(agentCall());
    w.teardown();
    expect(w.modes).toEqual(["human", "waking", "awake"]);

    useMapStore.getState().recordActivity(agentCall("draw_shape"));
    vi.advanceTimersByTime(AWAKEN_MAX_MS * 2);
    expect(w.modes).toEqual(["human", "waking", "awake"]);
  });
});
