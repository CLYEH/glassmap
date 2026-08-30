import { describe, expect, it } from "vitest";
import { bell, clamp01, inOutCubic, outBack, outCubic, seg, stagger } from "./easing";
import { FX_DURATIONS, FX_EFFECT_NAMES } from "./effects";
import { FX_MAX_MS, RM_MS } from "./driver";

describe("the timeline's arithmetic", () => {
  it("clamps, because a dropped frame must be a skipped frame, not a wrong one", () => {
    // The driver hands render() (now - t0)/dur, which overshoots whenever the
    // browser was busy. An effect that renders p = 1.4 would run its exit
    // easing backwards past its own end.
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
  });

  it("cuts a sub-window out of the global clock", () => {
    expect(seg(0.3, 0.3, 0.7)).toBe(0);
    expect(seg(0.5, 0.3, 0.7)).toBeCloseTo(0.5, 6);
    expect(seg(0.9, 0.3, 0.7)).toBe(1);
  });

  it("treats a zero-width window as a step, not a division by zero", () => {
    // Effects compute windows from a per-item stagger; with enough items two
    // boundaries can collide, and NaN would silently blank the whole frame.
    expect(seg(0.4, 0.5, 0.5)).toBe(0);
    expect(seg(0.5, 0.5, 0.5)).toBe(1);
    expect(Number.isNaN(seg(0.5, 0.5, 0.5))).toBe(false);
  });

  it("starts and ends every gaze at nothing on screen", () => {
    // Zero residue begins here: the transient envelope every read uses is 0 at
    // both ends, so a completed effect has already faded before cleanup runs.
    expect(bell(0)).toBeCloseTo(0, 10);
    expect(bell(1)).toBeCloseTo(0, 10);
    expect(bell(0.5)).toBeCloseTo(1, 10);
  });

  it("keeps the easings anchored at 0 and 1", () => {
    for (const ease of [outCubic, inOutCubic, outBack]) {
      expect(ease(0)).toBeCloseTo(0, 10);
      expect(ease(1)).toBeCloseTo(1, 10);
    }
    // outBack is the landing overshoot: it must actually overshoot, or the
    // drop-in reads as a fade.
    expect(Math.max(...[0.6, 0.7, 0.8].map(outBack))).toBeGreaterThan(1);
  });
});

describe("the N-scaling law", () => {
  it("never lets a large selection stretch the effect past its budget", () => {
    // A tool call may select hundreds of features. Without this the staggered
    // landing would take N x 50 ms and hold the map far past the 2 s law.
    for (const n of [1, 8, 30, 400]) {
      expect(stagger(n) * (n - 1)).toBeLessThanOrEqual(0.35);
    }
  });

  it("keeps a small selection legibly one-after-another", () => {
    expect(stagger(1)).toBe(0.05);
    expect(stagger(7)).toBeCloseTo(0.05, 6);
    expect(stagger(8)).toBeCloseTo(0.04375, 6);
  });

  it("survives a zero-length input rather than dividing by it", () => {
    expect(Number.isFinite(stagger(0))).toBe(true);
  });
});

describe("the ≤2 s law", () => {
  it("holds for every declared effect duration", () => {
    // "The calm map comes back" is the design's load-bearing promise; an
    // effect that declared 3 s would break it silently on one tool only.
    for (const name of FX_EFFECT_NAMES) {
      expect(FX_DURATIONS[name], name).toBeLessThanOrEqual(FX_MAX_MS);
      expect(FX_DURATIONS[name], name).toBeGreaterThan(0);
    }
  });

  it("keeps the reduced-motion variant inside the spec's 240 ms ceiling", () => {
    expect(RM_MS).toBeLessThanOrEqual(240);
  });
});
