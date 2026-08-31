import { beforeEach, describe, expect, it } from "vitest";
import { useAwakenStore } from "./awaken/mode-store";
import { chromeVisible, unseenCalls, usePanelStore, type ChromePanel } from "./panel-store";

const panel = () => usePanelStore.getState();
const setMode = (mode: "idle" | "waking" | "awake") => useAwakenStore.getState().setMode(mode);

describe("chromeVisible — the hand outranks the machine", () => {
  it("follows the machine while nobody has touched the toggle", () => {
    // The behaviour the whole app had before T-93, unchanged: the panels mount
    // for the story and stay for the end state.
    expect(chromeVisible("idle", null)).toBe(false);
    expect(chromeVisible("waking", null)).toBe(true);
    expect(chromeVisible("awake", null)).toBe(true);
  });

  it("shows the chrome on a page no agent has ever touched", () => {
    // The owner's ask: a visitor may look at what an agent sees without asking
    // an agent to act. The machine stays `idle` underneath — this is a
    // rendering fact, not a claim that anybody arrived.
    expect(chromeVisible("idle", "open")).toBe(true);
  });

  it("stays closed against the agent's next call", () => {
    // Review failure mode #1 (reopen-on-next-call). The machine is `awake` —
    // an agent really is working — and the person who closed the chrome by
    // hand still has their map. Nothing but their own tap reopens it.
    expect(chromeVisible("awake", "closed")).toBe(false);
  });

  it("cannot be talked out of a closed chrome by the transition either", () => {
    // Belt and braces: even if a `waking` ever reached a closed panel (the
    // reset below means it cannot), "closed" would still win. The precedence
    // is stated once, in one direction, so there is no state to reason about.
    expect(chromeVisible("waking", "closed")).toBe(false);
  });
});

describe("panel store", () => {
  beforeEach(() => {
    panel().followMachine();
    setMode("idle");
  });

  it("opening by hand never enters the machine", () => {
    // Review failure mode #3 (destroyed choreography): a manual open must not
    // spend the once-per-document Awakening. It writes the panel and nothing
    // else — no mode change, so `played` is untouched and the story is still
    // owed to whoever arrives first.
    panel().open();
    expect(panel().panel).toBe("open");
    expect(useAwakenStore.getState().mode).toBe("idle");
  });

  it("hands the question back to the machine the instant the story begins", () => {
    // The other half of the same ruling. The choreography measures the human
    // chrome it is about to displace; a panel still saying "open" would hand it
    // the agent positions as a starting point, and the story would animate from
    // its own destination. The reset is synchronous with the mode write, not an
    // effect, so it lands before the stage is mounted.
    panel().open();
    setMode("waking");
    expect(panel().panel).toBeNull();
  });

  it("does not disturb a hand-closed chrome when the machine merely lands", () => {
    // `waking → awake` is not an arrival, it is the end of one. A close made
    // during the story (or before it) must survive the landing — only the
    // *start* of a story resets the panel.
    panel().close(4);
    setMode("awake");
    expect(panel().panel).toBe("closed");
    expect(chromeVisible(useAwakenStore.getState().mode, panel().panel)).toBe(false);
  });

  it("survives a remount, because it is not a component's state", () => {
    // Review failure mode #4 (remount reopening). React unmounts and remounts
    // components — StrictMode does it twice on purpose — and a chrome that
    // reopened because a parent re-rendered would be reversing a decision the
    // person watching had just made. Module scope is the guarantee, the same
    // one `lib/awaken`'s `played` and `useShareHash`'s `applied` rely on: the
    // store is created once per document, so every subscriber that comes and
    // goes finds the same answer.
    panel().close(7);
    const unsubscribe = usePanelStore.subscribe(() => {});
    unsubscribe();
    expect(usePanelStore.getState().panel).toBe("closed");
    expect(usePanelStore.getState().seqAtClose).toBe(7);
  });

  it("clears the zero point on every exit from closed", () => {
    // The unseen count is measured from `seqAtClose`; a stale one left behind
    // by a reopen would print a number of calls the person has already seen.
    panel().close(3);
    panel().open();
    expect(panel().seqAtClose).toBeNull();
    panel().close(3);
    panel().followMachine();
    expect(panel().seqAtClose).toBeNull();
  });
});

describe("unseenCalls", () => {
  it("counts calls, not feed rows", () => {
    // The feed keeps 50 rows and folds runs of reads into one; both make a
    // row count a lie about how much the agent did while nobody was looking.
    // `activitySeq` is incremented once per recorded call and never rewound.
    expect(unseenCalls(9, 4)).toBe(5);
  });

  it("is zero while the chrome is not closed by hand", () => {
    expect(unseenCalls(9, null)).toBe(0);
  });

  it("is zero, not negative, if the sequence is somehow behind", () => {
    // A store reset (dev harness, a future "clear the feed") must never make
    // the control print "-3 calls".
    expect(unseenCalls(2, 6)).toBe(0);
  });
});

describe("the rendering contract, as a table", () => {
  // Every state the two facts can be in at once, so a change to the precedence
  // has to come here and say what it means rather than passing quietly.
  const cases: Array<[("idle" | "waking" | "awake"), ChromePanel, boolean]> = [
    ["idle", null, false],
    ["idle", "open", true],
    ["idle", "closed", false],
    ["waking", null, true],
    ["waking", "open", true],
    ["waking", "closed", false],
    ["awake", null, true],
    ["awake", "open", true],
    ["awake", "closed", false],
  ];
  for (const [mode, override, visible] of cases) {
    it(`${mode} + ${override ?? "no override"} → ${visible ? "agent" : "human"} chrome`, () => {
      expect(chromeVisible(mode, override)).toBe(visible);
    });
  }
});
