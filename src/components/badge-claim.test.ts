import { describe, expect, it } from "vitest";
import { BADGE_LABEL, badgeClaim } from "./badge-claim";

const surfaces = ["document.modelContext"];

describe("badgeClaim", () => {
  it("says an agent is connected only once a call has landed on this page", () => {
    // The badge is the loudest claim in the corner; `activity` is the only
    // store fact that means "an agent acted here, now" (`lib/awaken/`).
    expect(badgeClaim({ surfaces, calls: 1 })).toBe("connected");
    expect(BADGE_LABEL.connected).toBe("Agent connected");
  });

  it("says agent-readable on a restored link, which carries work and no agent", () => {
    // A link restores selection, shapes and notes an agent made *before it was
    // sent*; the wire carries no activity at all (`map-tools/share.ts`), so no
    // agent is here to be connected to. This is the page the whole rule exists
    // for: the feed's pulse holds still on it and its Listening row is
    // withheld, and the corner has to agree with them.
    expect(badgeClaim({ surfaces, calls: 0 })).toBe("readable");
    expect(BADGE_LABEL.readable).toBe("Agent-readable");
    expect(BADGE_LABEL.readable).not.toContain("connected");
  });

  it("promotes a restored page the moment it sees a call of its own", () => {
    // The claim becomes true and is made in the same breath - a restored page
    // that stayed "readable" through live calls would be under-claiming just
    // as dishonestly.
    expect(badgeClaim({ surfaces, calls: 0 })).toBe("readable");
    expect(badgeClaim({ surfaces, calls: 1 })).toBe("connected");
  });

  it("reports registration failure ahead of everything else", () => {
    // No surface means no tools were declared at all: whatever the map holds,
    // nothing can be reading it, and that is the fact worth printing.
    expect(badgeClaim({ surfaces: [], calls: 1 })).toBe("off");
    expect(badgeClaim({ surfaces: [], calls: 0 })).toBe("off");
    expect(BADGE_LABEL.off).toBe("WebMCP off");
  });
});
