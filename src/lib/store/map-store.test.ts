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
