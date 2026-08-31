/**
 * Coordinates as differences — the encoding that lets a traced outline or a
 * planned route fit in a share link.
 *
 * A point of a Taipei shape written as JSON costs about twenty bytes
 * ("121.53751,25.03262") and says nothing about the point before it, though
 * the two normally differ in the last two digits. This module writes the
 * difference instead: each value is scaled to the 5 decimals `round5` fixes
 * for the whole tool layer, subtracted from its predecessor on the same axis,
 * and written as a variable number of 6-bit digits. Points a few metres apart
 * cost one digit per axis; the encoding is Google's polyline algorithm
 * (zigzag + 5 data bits + a continuation bit) with a different alphabet.
 *
 * The alphabet is base64url's own 64 characters, not Google's ASCII 63..126,
 * for one reason: the result is a JSON string inside a base64url payload
 * (`share.ts`), and Google's range contains "\\", which JSON escapes into two
 * characters and base64 then charges for twice. These 64 need no escaping and
 * cost exactly 6 bits each, so a digit is a digit wherever it ends up.
 *
 * Two properties the caller depends on:
 *
 *  - **Lossless at 5 decimals.** `decodePolyline(encodePolyline(v))` is
 *    `v.map(round5)`, value for value, because both sides are the same integer
 *    divided by the same 1e5. The recipient's map has to be the sender's map,
 *    so an encoding that "nearly" round-trips would be a map that quietly
 *    disagrees with itself.
 *  - **Representation only.** Every point in is a point out. Dropping points to
 *    make a shape fit changes what the other side sees, and that is the
 *    caller's decision to take out loud, never this module's to take quietly.
 *
 * Nothing here throws, and nothing here validates a coordinate: it takes and
 * returns the flat [lng, lat, lng, lat, …] array `share.ts` already builds, so
 * both wire forms are held to one set of rules in one place. A string this
 * module cannot read at all comes back as `null`.
 */

/** base64url's alphabet, in its own order; the index *is* the digit's value. */
const DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUE_OF = new Map<string, number>([...DIGITS].map((digit, value) => [digit, value]));

/** 5 decimals: the precision `round5` (./state) gives every number this layer prints. */
const SCALE = 1e5;

/** The low 5 bits carry data; the sixth says "another digit follows". */
const DATA = 0x1f;
const CONTINUES = 0x20;

/**
 * At most six digits per number. Thirty bits holds the largest difference two
 * legal coordinates can produce (180 to -180 is 36 000 000 units, 72 000 000
 * zigzagged, 27 bits) and keeps every shift inside the 32 bits JavaScript's
 * bitwise operators work in. A seventh digit is a link nobody here wrote.
 */
const MAX_DIGITS = 6;

function encodeSigned(delta: number, out: string[]): void {
  // Zigzag first: -1, 1, -2, 2 … become 1, 2, 3, 4, so a step one unit west
  // costs a digit rather than a full-width sign bit.
  let value = delta < 0 ? ~(delta << 1) : delta << 1;
  while (value >= CONTINUES) {
    out.push(DIGITS[(value & DATA) | CONTINUES]);
    value >>>= 5;
  }
  out.push(DIGITS[value]);
}

/**
 * [lng, lat, lng, lat, …] as one string. The values are expected to be legal
 * coordinates already (`share.ts` checks them before and after); anything else
 * encodes and decodes back unchanged, which is what makes the round trip
 * testable on its own.
 */
export function encodePolyline(values: readonly number[]): string {
  const out: string[] = [];
  // Each axis is delta-encoded against its own predecessor. A path's
  // consecutive longitudes are metres apart, while a longitude and the
  // latitude beside it are a hundred degrees apart — one running total for
  // both would pay that hundred degrees on every single value.
  const previous = [0, 0];
  for (let i = 0; i < values.length; i++) {
    const axis = i % 2;
    const units = Math.round(values[i] * SCALE);
    encodeSigned(units - previous[axis], out);
    previous[axis] = units;
  }
  return out.join("");
}

/**
 * The flat array back, or `null` for anything that is not one of these strings:
 * a character outside the alphabet, a number longer than any coordinate needs,
 * or a trailing digit that promises another one. Never throws and never returns
 * NaN — this runs on text somebody else wrote.
 */
export function decodePolyline(value: unknown): number[] | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const values: number[] = [];
  const previous = [0, 0];
  let accumulator = 0;
  let shift = 0;
  let digits = 0;
  for (const character of value) {
    const digit = VALUE_OF.get(character);
    if (digit === undefined) return null;
    if (++digits > MAX_DIGITS) return null;
    accumulator |= (digit & DATA) << shift;
    if (digit & CONTINUES) {
      shift += 5;
      continue;
    }
    const delta = accumulator & 1 ? ~(accumulator >>> 1) : accumulator >>> 1;
    const axis = values.length % 2;
    const units = previous[axis] + delta;
    previous[axis] = units;
    values.push(units / SCALE);
    accumulator = 0;
    shift = 0;
    digits = 0;
  }
  // A string that ends mid-number was truncated somewhere between two people;
  // half a coordinate is not a shorter shape, it is a wrong one.
  return digits === 0 ? values : null;
}
