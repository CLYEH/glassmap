import { describe, expect, it } from "vitest";
import { CARD_COPY, cardProvenance } from "./card-model";

/**
 * The card is the one surface where a human is told, in a whole sentence, who
 * put a place on their map. Three of these sentences are possible and exactly
 * one of them is a hedge — which one, and when, is the whole of design2-v5
 * §2.5, and it is the difference between a page that reports provenance and a
 * page that invents it.
 */
describe("cardProvenance", () => {
  it("says the human tapped it only when the store recorded that they did", () => {
    // The click path writes `"user"` (MapCanvas's toggle). Nothing else may
    // produce this sentence: it is the only one that credits a person by name.
    expect(cardProvenance("user", false)).toBe("user");
    expect(cardProvenance("user", true)).toBe("user");
    expect(CARD_COPY.user.line).toContain("you tapped it");
  });

  it("names the agent when the record says so, whatever the link said", () => {
    expect(cardProvenance("agent", false)).toBe("agent");
    expect(CARD_COPY.agent.line).toContain("the agent selected it");
  });

  it("names the agent for an unrecorded id when the link carried `su`", () => {
    // `su` states the human's ids, so the complement is the sender's recorded
    // agent selection. Inference, but from evidence the wire actually carried.
    expect(cardProvenance(undefined, true)).toBe("agent");
  });

  it("hedges to the link when nothing on this page or the wire ever claimed it", () => {
    // A `su`-less link is one indistinguishable wire state — legacy, or
    // all-agent from the new encoder. The bead stays teal (Ruling 3's safe
    // direction, applied by the bead layer); only the sentence backs off, so
    // the page never asserts a fact it was not told.
    expect(cardProvenance(undefined, false)).toBe("link");
    expect(CARD_COPY.link.line).toContain("from a shared link");
    expect(CARD_COPY.link.line).not.toContain("agent");
  });
});
