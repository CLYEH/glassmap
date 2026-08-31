/**
 * The polyline codec — the one part of a share link that is compressed.
 *
 * Compression here is only allowed to change *how* the points travel, never
 * which points they are, so two claims carry the whole module and every test
 * below is one of them:
 *
 *  1. What comes back is what went in, at the 5 decimals `round5` fixes for the
 *     rest of the tool layer. The recipient's map has to be the sender's map;
 *     an encoding that lands a metre off, or drops the last point of a route,
 *     would leave both sides talking about a shape only one of them can see.
 *  2. It is read from a URL somebody else wrote. Every malformed string comes
 *     back as `null` — never a throw, never NaN, never a coordinate invented
 *     out of half a number.
 */
import { describe, expect, it } from "vitest";
import { decodePolyline, encodePolyline } from "./polyline";
import { round5 } from "./state";

/** Encode then decode, which is the only thing this module is ever asked to do. */
const roundTrip = (values: readonly number[]) => decodePolyline(encodePolyline(values));

/** A path of `count` points from a start, stepping by (dLng, dLat) each time. */
function path(start: [number, number], step: [number, number], count: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(round5(start[0] + step[0] * i), round5(start[1] + step[1] * i));
  }
  return values;
}

describe("polyline codec: what comes back is what went in", () => {
  it("returns exactly the numbers round5 would have printed, not nearly them", () => {
    // The tie to round5 is the whole precision contract: every tool answer, the
    // flat wire form and this one all say the same 5 decimals, so a link can
    // never disagree with the sentence the agent said about it.
    const values = [121.123456789, 25.987654321, 121.5375, 25.0325, -0.5, 0.000004];
    expect(roundTrip(values)).toEqual(values.map(round5));
    expect(roundTrip(values)).toEqual([121.12346, 25.98765, 121.5375, 25.0325, -0.5, 0]);
  });

  it("keeps a two-point line, which is the smallest thing draw_shape accepts", () => {
    // A one-segment line is not an edge case worth losing: "the corridor from
    // here to there" is two points, and the delta encoding has to survive
    // having exactly one difference to write down.
    expect(roundTrip([121.53, 25.03, 121.54, 25.03])).toEqual([121.53, 25.03, 121.54, 25.03]);
  });

  it("crosses the equator and the prime meridian, where the deltas change sign", () => {
    // Taipei never leaves the positive quadrant, so a sign bug here would ship
    // and only surface on somebody else's map. Zigzag exists for this case.
    const crossing = [-0.002, -0.001, -0.001, 0, 0, 0.001, 0.002, 0.002];
    expect(roundTrip(crossing)).toEqual(crossing);
  });

  it("survives the widest step two legal coordinates can be apart", () => {
    // 180 to -180 is the largest difference the encoding will ever be handed;
    // it must not silently overflow the 32-bit arithmetic the digits use.
    const corners = [180, 90, -180, -90, 0, 0];
    expect(roundTrip(corners)).toEqual(corners);
  });

  it("has one zero, the same one JSON has", () => {
    // round5(-0.000001) is -0, and the flat form has always written that as
    // "0" because JSON.stringify does. Matching it keeps the two wire forms of
    // one map decoding to the same map rather than to two maps that differ by
    // a sign nobody can see.
    expect(roundTrip([-0.000001, 0])).toEqual([0, 0]);
  });

  it("costs a digit or two per point where the flat form costs ten", () => {
    // The measurement the whole feature rests on. A 500-point route at ~40 m
    // spacing is a legal draw_shape call and, written as JSON numbers, is more
    // than the entire URL budget on its own.
    const route = path([121.5, 25.03], [0.0004, 0.0002], 500);
    const flat = JSON.stringify(route).length;
    const packed = encodePolyline(route).length;
    // Measured: 8268 characters of JSON against 2006 of polyline — and the
    // JSON has still to be base64'd, which charges another third on top.
    expect(flat).toBeGreaterThan(8000);
    expect(packed).toBeLessThan(flat / 4);
    expect(decodePolyline(encodePolyline(route))).toEqual(route);
  });

  it("refuses a number it has no digits for, instead of losing it in silence", () => {
    // The trap this guard exists for, and it is a trap for the *next* caller:
    // share.ts only ever hands over checked coordinates, so nothing on the wire
    // today can reach it. Someone packing a bounding box, a zoom or a distance
    // would have got a shorter list back than they put in, with nothing to tell
    // them - 1e6 overflowed the shift into a digit that does not exist, join()
    // rendered it as nothing, and the latitude behind it was then read as a
    // longitude. NaN was worse: it zigzagged to 0 and came back a real 0.
    expect(encodePolyline([1e6, 25])).toBe("");
    expect(encodePolyline([NaN, 25])).toBe("");
    expect(encodePolyline([121.5, Infinity])).toBe("");
    // Total, and refused on the way back in: never a shape nobody drew.
    expect(decodePolyline(encodePolyline([1e6, 25]))).toBeNull();

    // The boundary, in units of 1e-5: six digits carry 2^29 - 1 and no more.
    expect(roundTrip([0, 0, 5368.70911, 0])).toEqual([0, 0, 5368.70911, 0]);
    expect(encodePolyline([0, 0, 5368.70912, 0])).toBe("");

    // And the domain is comfortably wider than the map: the widest step two
    // legal coordinates can be apart is 14 times inside it, so nothing
    // share.ts can hand over is ever refused.
    expect(encodePolyline([180, 90, -180, -90])).not.toBe("");
  });

  it("encodes the origin as two zero digits, so the wire form is pinnable", () => {
    // A frozen example: if the alphabet or the digit layout ever changed, every
    // v3 link already sent would decode into a different map, and only a fixed
    // string catches that.
    expect(encodePolyline([0, 0])).toBe("AA");
    expect(decodePolyline("AA")).toEqual([0, 0]);
  });
});

describe("polyline codec: strings written by someone else", () => {
  const MALFORMED: { name: string; text: unknown }[] = [
    { name: "not a string", text: 7 },
    { name: "null", text: null },
    { name: "an array of numbers", text: [121.5, 25] },
    { name: "empty", text: "" },
    { name: "a character outside the alphabet", text: "AA*AA" },
    { name: "non-ASCII", text: "A公A" },
    { name: "an emoji", text: "A🚇A" },
    { name: "a number that never ends", text: "____" },
    { name: "a truncated last number", text: "AAA_" },
    { name: "more digits than a coordinate can need", text: "_______A" },
  ];

  it.each(MALFORMED)("returns null for $name rather than a guess", ({ text }) => {
    expect(decodePolyline(text)).toBeNull();
  });

  it("never invents a coordinate out of a string it half understood", () => {
    // A link is data, not code: whatever is pasted, the answer is either the
    // points somebody encoded or nothing at all. NaN would travel silently into
    // turf and out again as a measurement of a shape that does not exist.
    let seed = 20260831;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const alphabet = "ABYZaz09-_";
    let read = 0;
    for (let n = 0; n < 500; n++) {
      let text = "";
      for (let i = 0; i < Math.floor(random() * 12); i++) {
        text += alphabet[Math.floor(random() * alphabet.length)];
      }
      const out = decodePolyline(text);
      if (out === null) continue;
      read++;
      expect(out.every((value) => Number.isFinite(value))).toBe(true);
    }
    // Without this the sweep proves nothing: a decoder that answered `null` to
    // everything - the easiest way to pass a "never returns NaN" test - would
    // skip every assertion above and stay green. Measured: 236 of the 500
    // strings are readable.
    expect(read).toBeGreaterThan(100);
  });
});
