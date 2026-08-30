import { beforeEach, describe, expect, it } from "vitest";
import {
  countsSentence,
  resetRestoredLatch,
  restoredChipCopy,
  restoredSummary,
  restoredTicker,
  selectionClaim,
  type RestoredState,
} from "./restored-model";

/**
 * The restored page's claims, tested as claims: every case here is about
 * whether a sentence on screen is *true of the link that produced it*.
 *
 * The wire carries no activity, so the recipient's feed can say exactly one
 * thing — how much came through — and the round-4 finding this replaces was a
 * feed that narrated seven calls no recipient could ever have received.
 */

const link = (over: Partial<RestoredState> = {}): RestoredState => ({
  restoredAgentState: true,
  selection: [],
  drawings: [],
  annotations: [],
  ...over,
});

beforeEach(resetRestoredLatch);

describe("the synthesized summary row", () => {
  it("says only what the decoded objects prove", () => {
    const state = link({
      selection: Array.from({ length: 42 }, (_, i) => `poi:${i}`),
      drawings: [{ source: "agent" }],
      annotations: [{ source: "agent" }],
    });
    expect(restoredSummary(state)).toBe("The link carried 42 selected · 1 shape · 1 note");
  });

  it("drops what the link did not carry instead of counting it to zero", () => {
    // "0 shapes · 0 notes" is chrome pretending to be content.
    expect(restoredSummary(link({ selection: ["a", "b"] }))).toBe("The link carried 2 selected");
  });

  it("pluralises what it counts", () => {
    expect(countsSentence({ selected: 1, shapes: 2, notes: 3 })).toBe(
      "1 selected · 2 shapes · 3 notes",
    );
  });

  it("is absent on a page that opened no link", () => {
    expect(restoredSummary(link({ restoredAgentState: false, selection: ["a"] }))).toBeNull();
    expect(restoredTicker(link({ restoredAgentState: false }))).toBeNull();
  });

  it("has no row rather than a sentence that trails off", () => {
    expect(restoredSummary(link())).toBeNull();
    expect(countsSentence({ selected: 0, shapes: 0, notes: 0 })).toBeNull();
  });

  it("keeps the link's counts after the person changes the map", () => {
    // The load-bearing one. "The link carried 42 selected" is a claim about the
    // past; read live off the store it would follow the selection and quietly
    // become a lie about a link that is already gone.
    const opened = link({ selection: ["a", "b"], drawings: [{ source: "agent" }] });
    expect(restoredSummary(opened)).toBe("The link carried 2 selected · 1 shape");
    const later = link({
      selection: ["a", "b", "c", "d"],
      drawings: [{ source: "agent" }, { source: "user" }],
    });
    expect(restoredSummary(later)).toBe("The link carried 2 selected · 1 shape");
    expect(restoredTicker(later)).toBe("Restored from a link — 2 selected · 1 shape");
  });
});

describe("the restored chip", () => {
  it("claims agent actions only where the wire proves them", () => {
    // A drawing's or a note's `source` rides every link the codec has ever
    // written, so one agent-sourced mark is evidence, not a presumption.
    expect(restoredChipCopy(link({ drawings: [{ source: "agent" }] }))).toBe(
      "Restored from a link · includes agent actions",
    );
    expect(restoredChipCopy(link({ annotations: [{ source: "agent" }] }))).toBe(
      "Restored from a link · includes agent actions",
    );
  });

  it("hedges to the plain sentence when the only evidence is a selection", () => {
    // A `su`-less link cannot be split into "legacy" and "all-agent from a new
    // encoder", so who selected those ids is presumed, never proven — and a
    // chip is a claim surface like any other.
    expect(restoredChipCopy(link({ selection: ["a", "b"] }))).toBe("Restored from a link");
    expect(restoredChipCopy(link({ drawings: [{ source: "user" }] }))).toBe(
      "Restored from a link",
    );
  });

  it("is absent on a page that opened no link", () => {
    expect(restoredChipCopy(link({ restoredAgentState: false }))).toBeNull();
  });
});

describe("the SELECTED section's tag", () => {
  it("lets a recorded source win over the link's presumption", () => {
    // The map never guesses a source it was handed: `selectionSources` is
    // written at the moment of the selection by whoever made it.
    expect(selectionClaim(["a"], { a: "agent" }, false)).toBe("AGENT");
    expect(selectionClaim(["a"], { a: "user" }, true)).toBe("YOU");
  });

  it("hedges unrecorded ids to the link when the link never said who selected", () => {
    expect(selectionClaim(["a", "b"], {}, false)).toBe("FROM LINK");
  });

  it("names the agent for unrecorded ids when the link did say (su present)", () => {
    // `su` carries the human's ids, so everything outside it is recorded-agent:
    // explicit evidence, and the tag may assert.
    expect(selectionClaim(["a", "b"], { a: "user" }, true)).toBeNull();
    expect(selectionClaim(["b"], {}, true)).toBe("AGENT");
  });

  it("says nothing at all about a mixed selection", () => {
    // One word cannot be true of a list whose rows have different owners, and
    // over-claiming here is exactly what the hedge exists to prevent.
    expect(selectionClaim(["a", "b"], { a: "user", b: "agent" }, true)).toBeNull();
  });

  it("has no tag when nothing is selected", () => {
    expect(selectionClaim([], {}, false)).toBeNull();
  });
});
