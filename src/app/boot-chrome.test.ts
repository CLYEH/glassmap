import { describe, expect, it } from "vitest";
import {
  decodeShareState,
  encodeShareState,
  restoredAgentStateOf,
  type ShareState,
} from "@/lib/map-tools/share";
import { BOOT_CHROME_SCRIPT } from "./boot-chrome";

/**
 * Run the inline script the way the browser will, with a fake document and a
 * fake location, and report what it wrote on the root element.
 *
 * `new Function` rather than `eval` so the script's free `document` and
 * `location` bind to these two parameters and nothing else: the script is
 * whatever it says it is, not whatever this file happens to have in scope.
 */
function bootChrome(hash: string): string | undefined {
  const root = { dataset: {} as { chrome?: string } };
  const run = new Function("document", "location", BOOT_CHROME_SCRIPT);
  run({ documentElement: root }, { hash });
  return root.dataset.chrome;
}

const view = { center: [121.5654, 25.033] as [number, number], zoom: 12, bearing: 0, pitch: 0 };

const link = (state: Partial<ShareState>): string =>
  encodeShareState({ view, selection: [], drawings: [], annotations: [], ...state });

/** What the page will conclude once the real codec has run, for comparison. */
function decodedAgentState(hash: string): boolean {
  const decoded = decodeShareState(hash);
  return "error" in decoded ? false : restoredAgentStateOf(decoded);
}

const circle = {
  kind: "circle" as const,
  geometry: { type: "Polygon" as const, coordinates: [[]] },
  center: [121.5654, 25.033] as [number, number],
  radius_m: 800,
};

const note = { at: [121.5654, 25.033] as [number, number], note: "quiet street" };

/**
 * The whole point of the probe is that it agrees with `restoredAgentStateOf`
 * on every link this build can produce. It is a second reader of a wire format
 * it does not own, so these cases are the contract between the two: if the
 * codec's answer moves and the probe's does not, the page paints the wrong
 * chrome for a frame on every restored link, and nothing else in the suite
 * would notice.
 */
describe("the boot-chrome probe", () => {
  const cases: Array<[string, string]> = [
    ["nothing at all", ""],
    ["a fragment that is not a share link", "#section-2"],
    ["a camera and nothing else", `#${link({})}`],
    ["a human's own shape", `#${link({ drawings: [{ ...circle, source: "user" }] })}`],
    ["an agent's shape", `#${link({ drawings: [{ ...circle, source: "agent" }] })}`],
    ["a human's own note", `#${link({ annotations: [{ ...note, source: "user" }] })}`],
    ["an agent's note", `#${link({ annotations: [{ ...note, source: "agent" }] })}`],
    [
      "a selection the link proves is the human's",
      `#${link({ selection: ["park:1", "park:2"], userSelected: ["park:1", "park:2"] })}`,
    ],
    [
      "a selection the link only half attributes",
      `#${link({ selection: ["park:1", "park:2"], userSelected: ["park:1"] })}`,
    ],
    ["a selection the link says nothing about", `#${link({ selection: ["park:1"] })}`],
    [
      "a human's map with tier-2 categories (a v2 link)",
      `#${link({
        selection: ["osm:node:1"],
        userSelected: ["osm:node:1"],
        categories: ["cafe"],
        annotations: [{ ...note, source: "user" }],
      })}`,
    ],
    ["a link with no leading hash", link({ drawings: [{ ...circle, source: "agent" }] })],
  ];

  for (const [name, hash] of cases) {
    it(`agrees with the codec on ${name}`, () => {
      const expected = decodedAgentState(hash) ? "awake" : "idle";
      // "idle" and "unwritten" are the same chrome (the stylesheet reads the
      // human chrome as the absence of "awake"), so a refused link may either
      // say so or say nothing — it may never say "awake".
      expect(bootChrome(hash) ?? "idle").toBe(expected);
    });
  }

  it("refuses a payload the codec would refuse whole, rather than guessing", () => {
    // No camera: `decodeShareState` returns an error and the page restores
    // nothing, so the chrome must not be dressed for a map that never arrives.
    const payload = btoa(JSON.stringify({ a: [{ o: "agent", p: [121.5, 25], n: "x" }] }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(bootChrome(`#v1.${payload}`)).toBeUndefined();
    expect(decodedAgentState(`#v1.${payload}`)).toBe(false);
  });

  it("survives a fragment that is not base64, JSON, or ours", () => {
    // Whatever is after the "#" is not ours to police: an anchor, a paste that
    // lost its tail, a link from a build that knows more than this one. None of
    // them may throw before the page has painted.
    for (const hash of ["#v1.!!!!", "#v1.YWJj", "#v9.YWJj", "#", "#v1."]) {
      expect(bootChrome(hash) ?? "idle").toBe("idle");
    }
  });

  it("reads a UTF-8 note without decoding it", () => {
    // The payload is parsed as bytes, so a multi-byte note arrives as mojibake
    // inside the JSON string — which is exactly why no answer may depend on the
    // text. The agent's note still has to be seen.
    const hash = `#${link({ annotations: [{ ...note, source: "agent", note: "café · 日本橋" }] })}`;
    expect(bootChrome(hash)).toBe("awake");
    expect(decodedAgentState(hash)).toBe(true);
  });
});
