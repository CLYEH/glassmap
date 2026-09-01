import { describe, expect, it } from "vitest";
import { createMapTools } from "@/lib/map-tools";
import { createMemoryToolStore } from "@/lib/store/map-store";
import { ASK_CARDS, SHEET_ASK_CARDS } from "./TryAsking";
import { DECLARATIVE_TOOLS } from "./tool-roster";

/**
 * "Try asking" makes a narrower promise than the tool roster does: not just
 * that a tool exists, but that THESE tools answer THIS sentence. The half of
 * that a unit test can hold is the first half — and it is the half that rots
 * silently, because a card is static text nothing else imports. If the tool
 * layer renames `get_place_details`, `tool-roster.test.ts` moves the chip and
 * leaves the card pointing at a tool that no longer answers.
 *
 * The second half — that the chain named is the chain the sentence actually
 * needs, and that the fields it asks for are non-empty on the place it names —
 * is only provable against the shipped data on a live page; see TryAsking.tsx's
 * own doc comment for the run that established it.
 */
describe("ASK_CARDS", () => {
  const registered = new Set([
    ...createMapTools(createMemoryToolStore()).map((tool) => tool.name),
    ...DECLARATIVE_TOOLS,
  ]);

  it("only names tools this page actually registers", () => {
    for (const card of ASK_CARDS) {
      const named = card.tools.split("·").map((name) => name.trim());
      for (const name of named) {
        expect(registered, `${card.question} promises "${name}"`).toContain(name);
      }
    }
  });

  /**
   * The one assertion here that pins a card rather than checking one. Delete the
   * `get_place_details` card and every other test in this repo still passes —
   * which is exactly the rot that made F-4 a ticket: the page's richest read
   * tool shipped in T-97 as the only headline tool with no sentence on the
   * landing screen, and nothing noticed for a release. This is not redundant
   * with the tag check above, which only asks that whatever a card names is
   * real; it asks that this particular promise is still being made at all.
   */
  it("still advertises get_place_details, the tool F-4 caught going unmentioned", () => {
    const advertising = ASK_CARDS.filter((card) => card.tools.includes("get_place_details"));
    expect(
      advertising.length,
      "no ASK_CARD names get_place_details: the landing screen has stopped pointing anyone at the richest read tool the page has (F-4)",
    ).toBeGreaterThan(0);
  });

  it("shows the sheet a subset of the same cards, never a divergent copy", () => {
    for (const card of SHEET_ASK_CARDS) expect(ASK_CARDS).toContain(card);
  });
});
