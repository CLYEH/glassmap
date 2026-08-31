/**
 * The FX timeline's arithmetic: every effect is a pure `render(p)` over
 * `p ∈ [0,1]`, so a frame can be played by rAF or frozen at any `p` by a test.
 * Nothing here touches the DOM, which is why the whole timeline is unit
 * testable in the node environment vitest runs in.
 *
 * The easings are the mockup's (`fx-mockup-v3.html`), value for value — the
 * spec's per-effect choreography is written against these curves, so changing
 * one would silently redesign seventeen effects.
 */

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The sub-timeline `[a,b]` of the global clock, as its own 0..1 progress.
 * `b <= a` collapses to a step at `a` rather than dividing by zero.
 */
export function seg(p: number, a: number, b: number): number {
  if (b <= a) return p < a ? 0 : 1;
  return clamp01((p - a) / (b - a));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function outCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

export function inOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

export function inOutSine(p: number): number {
  return -(Math.cos(Math.PI * p) - 1) / 2;
}

/** Overshoots past 1 and settles back — the "drop-in" landing. */
export function outBack(p: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
}

/** 0 → 1 → 0 across the whole window: the shape of every transient gaze. */
export function bell(p: number): number {
  return Math.sin(Math.PI * clamp01(p));
}

/** Three decimals is below the compositor's resolution and keeps attributes short. */
export function fixed3(v: number): string {
  return v.toFixed(3);
}

/**
 * The stagger one landing gets when N of them share the effect.
 *
 * The N-scaling law (spec v2, restated by v3): the whole staggered entrance
 * must fit inside 35% of the timeline however many features were selected, so
 * a 400-feature selection cannot turn a 1.4 s effect into a 20 s one — and the
 * per-item stagger never exceeds the 50 ms that makes a small selection read
 * as "one after another" rather than "all at once".
 */
export function stagger(n: number): number {
  return Math.min(0.05, 0.35 / Math.max(1, n));
}
