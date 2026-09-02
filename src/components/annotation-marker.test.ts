import { describe, expect, it } from "vitest";
import { foldedLabel } from "./annotation-marker";

/**
 * A folded pin is the state T-107 exists to make survivable: before it, folding
 * a note left a 9 px dot and no way back. The chip's label is the part of that
 * promise a test can hold without a browser — a folded note still says which
 * note it is, and it always says *something*.
 */
describe("folded pin label", () => {
  it("keeps the note's first word, so a folded pin is still recognisable", () => {
    expect(foldedLabel("quiet street, good light")).toBe("quiet…");
  });

  it("clips a long first word instead of widening the chip", () => {
    // A URL or a hashtag has no spaces and would otherwise print in full over
    // the map it is meant to be folded out of.
    expect(foldedLabel("supercalifragilistic expialidocious")).toBe("supercalifragi…");
  });

  it("clips a note with no spaces at all by length", () => {
    // 大安森林公園 is one word to a splitter and a whole note to a reader.
    expect(foldedLabel("大安森林公園旁邊的長椅很安靜，午後有樹蔭")).toBe("大安森林公園旁邊的長椅很安靜…");
  });

  it("still shows something for a note that is only whitespace", () => {
    // The chip is the way back; an empty one is a fold with no handle.
    expect(foldedLabel("   ")).toBe("…");
  });
});
