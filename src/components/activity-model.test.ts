import { describe, expect, it } from "vitest";
import {
  callCountLabel,
  feedIsLive,
  formatCallTime,
  groupActivity,
  selectActivity,
  splitSummary,
  type ActivityEntry,
} from "./activity-model";

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  seq: 1,
  tool: "draw_shape",
  summary: "Circle, 800 m — “10-min walk” → drawing:1",
  readOnly: false,
  ok: true,
  at: 0,
  ...over,
});

describe("selectActivity", () => {
  it("hands back the store's own array, not a copy", () => {
    // zustand compares selector results by identity: a copy would look like a
    // change on every unrelated store write and re-render the whole feed.
    const activity = [entry()];
    expect(selectActivity({ activity })).toBe(activity);
  });
});

describe("splitSummary", () => {
  it("marks only the ids the call itself reported", () => {
    expect(splitSummary("Circle → drawing:1", ["drawing:1"])).toEqual([
      { text: "Circle → ", code: false },
      { text: "drawing:1", code: true },
    ]);
  });

  it("leaves a note's own words alone even when they look like an id", () => {
    // The summary of `annotate` quotes what a human or an agent typed. If it
    // says "meeting:1" that is prose, not a store id, and typesetting it as
    // machine output would credit the tool with something it never returned.
    const summary = 'Pinned “meeting:1 at noon” → annotation:2';
    expect(splitSummary(summary, ["annotation:2"])).toEqual([
      { text: "Pinned “meeting:1 at noon” → ", code: false },
      { text: "annotation:2", code: true },
    ]);
  });

  it("passes a summary through untouched when there are no ids", () => {
    expect(splitSummary("Read the camera", undefined)).toEqual([
      { text: "Read the camera", code: false },
    ]);
  });
});

describe("groupActivity", () => {
  const read = (seq: number, tool = "get_map_state") =>
    entry({ seq, tool, readOnly: true, summary: `read ${seq}` });
  const write = (seq: number) => entry({ seq, tool: "draw_shape", readOnly: false });

  it("keeps every write on its own row", () => {
    const activity = [write(1), write(2), write(3)];
    expect(groupActivity(activity).map((row) => row.entry.seq)).toEqual([1, 2, 3]);
  });

  it("folds a run of reads into the newest one, counted", () => {
    // An agent that polls state between steps must not push the writes -- the
    // rows that say what changed -- out of a 50-row feed.
    const activity = [write(1), read(2), read(3), read(4), write(5)];
    expect(groupActivity(activity)).toEqual([
      { entry: activity[0], folded: 1 },
      { entry: activity[3], folded: 3 },
      { entry: activity[4], folded: 1 },
    ]);
  });

  it("leaves a short run alone", () => {
    const activity = [read(1), read(2), write(3)];
    expect(groupActivity(activity).map((row) => row.folded)).toEqual([1, 1, 1]);
  });

  it("never folds a failed read away", () => {
    // A call that failed is exactly what someone is scanning the feed for.
    const activity = [
      read(1),
      read(2),
      read(3),
      entry({ seq: 4, readOnly: true, ok: false }),
      read(5),
      read(6),
      read(7),
    ];
    expect(groupActivity(activity)).toEqual([
      { entry: activity[2], folded: 3 },
      { entry: activity[3], folded: 1 },
      { entry: activity[6], folded: 3 },
    ]);
  });
});

describe("formatCallTime", () => {
  it("is a 24-hour wall clock, seconds included", () => {
    // A feed of calls seconds apart is unreadable without seconds, and 12-hour
    // time would put an am/pm where the design has none.
    expect(formatCallTime(new Date(2026, 7, 29, 14, 2, 11).getTime())).toBe("14:02:11");
    expect(formatCallTime(new Date(2026, 7, 29, 0, 5, 9).getTime())).toBe("00:05:09");
  });
});

describe("callCountLabel", () => {
  it("does not say “1 calls”", () => {
    expect(callCountLabel(1)).toBe("1 call");
    expect(callCountLabel(6)).toBe("6 calls");
    expect(callCountLabel(0)).toBe("0 calls");
  });
});

describe("feedIsLive — what the pulsing ring is allowed to mean", () => {
  it("holds still until a call has actually landed here", () => {
    // The feed can now be on screen with nothing behind it: a restored link
    // carries agent work and no agent, and since T-93 a person can open the
    // agent chrome by hand on a map nothing has ever touched. An animated
    // "live" light over either is a claim the page cannot back — and the
    // second case is one the old `data-restored` gate did not even cover.
    expect(feedIsLive(0)).toBe(false);
  });

  it("animates over the page's own calls, and only those", () => {
    // `activity` is written by `recordActivity` alone, from the tool
    // instrumentation and the agent-submitted note form — never by a restore
    // and never by a human's own hand (`lib/awaken/index.ts`).
    expect(feedIsLive(1)).toBe(true);
    expect(feedIsLive(50)).toBe(true);
  });
});
