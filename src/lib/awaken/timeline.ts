/**
 * The awakening's schedule: which beat is where on the 1800 ms clock, and how
 * far along each one is at a given `p`.
 *
 * Split out of the choreography for the same reason `components/fx/easing.ts`
 * is split out of the effects: the windows are the design contract's own
 * numbers (design2-v5 §6, `mockup2-v5.html`'s storyboard comment), the
 * retimings in them were argued for with a contrast meter, and a number that
 * carries an argument has to be assertable without a browser. The component
 * reads `phase(p, tier)` and paints; nothing here touches the DOM.
 *
 * Two tiers, one clock. The desktop story is about a *panel condensing out of
 * light* and a *pane arriving from the east*; below 921px there is no lane and
 * no floating feed (globals.css), so the same 1800 ms carries a ticker and a
 * rising sheet instead. They are separate objects rather than one with holes
 * in it because "the mobile story has no slab" should be a fact you can read.
 *
 * ## Why these windows and not others
 *
 *  - `slab` and `listen` both end at **.50**, not .58/.55 (r4 finding 5). A
 *    freeze at t=.5 is the frame people take of this transition, and at the
 *    old windows the Listening row sat at half opacity inside a half-resolved
 *    slab: 2.46:1, present but not legible. Both at 1.0 at .50 measures ~5.9:1.
 *    Claimed-visible has to mean legible, so the two move together — a row at
 *    full opacity inside a translucent slab still lets the map bleed through.
 *  - `laneText` starts after `lane` (r3 finding 7a): the glass pane's leading
 *    edge passes first and its words condense behind it, so no frame can show
 *    half a word clipped by the edge that is drawing it.
 *  - `row` and `caption` are the only beats that end at 1: the first call
 *    finishes writing itself as the story lands, and the caption blooms into
 *    the toast that outlives it.
 *  - Mobile's `flare` runs to .22 rather than .14 because the ripple's ring
 *    leaves a 390 px viewport almost immediately — the flare is what carries
 *    the early freezes there.
 */

/** A beat's slice of the global clock, in `p`. */
export interface AwakenWindow {
  readonly from: number;
  readonly to: number;
}

/**
 * The mockup's own easing (`ease`, `mockup2-v5.html`): quadratic in-out. Not
 * imported from `components/fx/easing.ts` — that file is the FX driver's, this
 * module is under `lib/`, and the dependency would point the wrong way — and
 * not `inOutCubic`, which is the FX curve: the storyboard was drawn against
 * this one and every window's feel is calibrated to it.
 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Where `p` sits inside a window, clamped to it, with no easing. */
export function linear(p: number, window: AwakenWindow): number {
  const { from, to } = window;
  if (to <= from) return p < from ? 0 : 1;
  const t = (p - from) / (to - from);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Where `p` sits inside a window, eased. */
export function eased(p: number, window: AwakenWindow): number {
  return easeInOut(linear(p, window));
}

/** 0 → 1 → 0 across a window: the shape of a flash that leaves nothing behind. */
export function flash(p: number, window: AwakenWindow): number {
  return Math.sin(Math.PI * linear(p, window));
}

/**
 * The desktop storyboard, beat by beat (design2-v5 §6).
 *
 * `hint` is the one beat that removes something: the landing hint bar goes out
 * in the first tenth, before anything has arrived to replace it.
 */
export const DESKTOP_BEATS = {
  /** The spark ignites: a scale burst and a plus-lighter halo at its true position. */
  flare: { from: 0, to: 0.14 },
  /** A lens-wave expands from the spark across the whole glass. */
  ripple: { from: 0.04, to: 0.44 },
  /** Light gathers where the feed is about to be. */
  bloom: { from: 0.1, to: 0.48 },
  /** The feed slab resolves inside that light — hard by the t=.5 freeze. */
  slab: { from: 0.18, to: 0.5 },
  /** The Listening row rides the slab's hardening, so a hard panel is never mute. */
  listen: { from: 0.38, to: 0.5 },
  /** The inspector pane slides in from the east, displacing the chrome in sync. */
  lane: { from: 0.44, to: 0.8 },
  /** A specular sweep across the slab. */
  sheen: { from: 0.55, to: 0.78 },
  /** The pane's words, after its edge has passed. */
  laneText: { from: 0.6, to: 0.82 },
  /** The spark hands over to the badge. */
  badge: { from: 0.68, to: 0.9 },
  /** The first call writes itself; the camera chip joins it. */
  row: { from: 0.72, to: 1 },
  /** "An agent joined this map" blooms — then lives on as the toast. */
  caption: { from: 0.9, to: 1 },
  /** The landing hint leaves first. */
  hint: { from: 0, to: 0.1 },
} as const satisfies Record<string, AwakenWindow>;

/**
 * The 390 px storyboard (design2-v5 §6, mobile). No slab, no lane, no sheen:
 * the sheet tier has neither a floating feed nor an east pane to arrive.
 *
 * The storyboard's "legend yields its band" beat has no window here, and that
 * is a deliberate reading of it against the chrome this app actually ships: on
 * the mockup's phone layout the ticker lands where the legend was, so the
 * legend had to leave first. Ours puts the ticker under the brand, over empty
 * map, and keeps the legend — so nothing is displaced by the ticker, and what
 * the sheet displaces (legend, attribution, badge, dock: the whole bottom
 * band) rides its top edge on the `sheet` beat instead. A fade-out beat here
 * would have to fade the band back in at the end, which is a flicker, not a
 * storyboard.
 */
export const MOBILE_BEATS = {
  flare: { from: 0, to: 0.22 },
  ripple: { from: 0.04, to: 0.44 },
  /** The ticker slides in under the brand. */
  ticker: { from: 0.24, to: 0.5 },
  /** …and types the first call's summary into itself. */
  type: { from: 0.28, to: 0.55 },
  /** The sheet rises, quiet, carrying the bottom band up on its top edge. */
  sheet: { from: 0.5, to: 0.84 },
  /** The spark fades: the ticker's pulse is the live flag now. */
  spark: { from: 0.68, to: 0.88 },
  badge: { from: 0.68, to: 0.9 },
  caption: { from: 0.9, to: 1 },
  hint: { from: 0, to: 0.1 },
} as const satisfies Record<string, AwakenWindow>;

/** Which storyboard a viewport gets. The 921 px line is `SHEET_TIER`'s. */
export type AwakenTier = "desktop" | "mobile";

export type DesktopBeat = keyof typeof DESKTOP_BEATS;
export type MobileBeat = keyof typeof MOBILE_BEATS;

/** Every beat of a tier, as its own 0..1 progress at the global `p`. */
export type AwakenPhase<K extends string> = Readonly<Record<K, number>>;

/**
 * The whole storyboard at one instant.
 *
 * Eased everywhere except the three beats the mockup runs linearly — the
 * typewriter (characters land at a steady rate; easing them would stall the
 * cursor mid-word), the sheen (a specular sweep is a constant-speed light) and
 * the hint's exit. `flare` is returned as its raw window progress: it is
 * painted through a bell rather than a ramp, and that shape belongs to the
 * light, not to the clock.
 *
 * Pure, total, and defined for every real number: a frozen still at p=1.4 or a
 * clock that overshoots by a frame gets the end state, never a NaN transform.
 */
export function phase(p: number, tier: "desktop"): AwakenPhase<DesktopBeat>;
export function phase(p: number, tier: "mobile"): AwakenPhase<MobileBeat>;
export function phase(p: number, tier: AwakenTier): AwakenPhase<string>;
export function phase(p: number, tier: AwakenTier): AwakenPhase<string> {
  if (tier === "mobile") {
    return {
      flare: linear(p, MOBILE_BEATS.flare),
      ripple: eased(p, MOBILE_BEATS.ripple),
      ticker: eased(p, MOBILE_BEATS.ticker),
      type: linear(p, MOBILE_BEATS.type),
      sheet: eased(p, MOBILE_BEATS.sheet),
      spark: eased(p, MOBILE_BEATS.spark),
      badge: eased(p, MOBILE_BEATS.badge),
      caption: eased(p, MOBILE_BEATS.caption),
      hint: linear(p, MOBILE_BEATS.hint),
    };
  }
  return {
    flare: linear(p, DESKTOP_BEATS.flare),
    ripple: eased(p, DESKTOP_BEATS.ripple),
    bloom: eased(p, DESKTOP_BEATS.bloom),
    slab: eased(p, DESKTOP_BEATS.slab),
    listen: eased(p, DESKTOP_BEATS.listen),
    lane: eased(p, DESKTOP_BEATS.lane),
    sheen: linear(p, DESKTOP_BEATS.sheen),
    laneText: eased(p, DESKTOP_BEATS.laneText),
    badge: eased(p, DESKTOP_BEATS.badge),
    row: eased(p, DESKTOP_BEATS.row),
    caption: eased(p, DESKTOP_BEATS.caption),
    hint: linear(p, DESKTOP_BEATS.hint),
  };
}

/**
 * How many characters of a summary are on screen at `t` — the ticker's
 * typewriter, quantised so the same `t` always types the same prefix.
 */
export function typedChars(total: number, t: number): number {
  return Math.round(total * (t < 0 ? 0 : t > 1 ? 1 : t));
}
