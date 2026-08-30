import { describe, expect, it } from "vitest";
import {
  DESKTOP_BEATS,
  MOBILE_BEATS,
  eased,
  flash,
  linear,
  phase,
  typedChars,
  type AwakenWindow,
} from "./timeline";

/**
 * The storyboard's numbers, asserted for the reasons they were chosen.
 *
 * Every one of these is a claim the design contract makes about a *frame* — a
 * still somebody freezes and looks at — so each test names the frame and what
 * would be wrong with it if the window moved. A test that only checked
 * `phase(0.5).slab === 1` would pass for the wrong window as happily as for
 * the right one; these say why .50 and not .58.
 */

const windows = (beats: Record<string, AwakenWindow>) => Object.entries(beats);

describe("window arithmetic", () => {
  it("is total: any p outside a window resolves to its end state, never NaN", () => {
    // A frozen still can be asked for p=1.4, and a rAF clock overshoots its
    // last frame. Both must paint the end state rather than a NaN transform,
    // which in CSS is an ignored declaration — i.e. half-displaced chrome.
    const window = { from: 0.2, to: 0.6 };
    expect(linear(-3, window)).toBe(0);
    expect(linear(9, window)).toBe(1);
    expect(eased(Number.POSITIVE_INFINITY, window)).toBe(1);
    expect(Number.isNaN(eased(0.4, { from: 0.5, to: 0.5 }))).toBe(false);
  });

  it("collapses a zero-length window to a step instead of dividing by zero", () => {
    expect(linear(0.49, { from: 0.5, to: 0.5 })).toBe(0);
    expect(linear(0.5, { from: 0.5, to: 0.5 })).toBe(1);
  });

  it("eases without changing where a beat starts and ends", () => {
    // The easing is a feel, not a schedule: a beat that ended early under its
    // curve would break the "positions equal the awake CSS at p=1" contract.
    for (const [, window] of windows(DESKTOP_BEATS)) {
      expect(eased(window.from, window)).toBe(0);
      expect(eased(window.to, window)).toBe(1);
    }
  });

  it("flashes to full at the middle of its window and back to nothing", () => {
    // The flare leaves no residue — it is light, and light that ended at 1
    // would still be on the screen when the story lands.
    expect(flash(0, { from: 0, to: 0.2 })).toBeCloseTo(0, 6);
    expect(flash(0.1, { from: 0, to: 0.2 })).toBeCloseTo(1, 6);
    expect(flash(0.2, { from: 0, to: 0.2 })).toBeCloseTo(0, 6);
  });
});

describe("the desktop storyboard", () => {
  it("has every beat complete at p=1, so nothing jumps when the story lands", () => {
    // The choreography drives the chrome to the exact position the awake
    // stylesheet gives it and then hands over by clearing the inline styles.
    // A beat still short of 1 at p=1 is a visible snap at the handover.
    for (const [name, value] of Object.entries(phase(1, "desktop"))) {
      expect(value, `${name} at p=1`).toBe(1);
    }
  });

  it("starts with nothing but the flare: at p=0 every other beat is still 0", () => {
    const at0 = phase(0, "desktop");
    for (const [name, value] of Object.entries(at0)) {
      expect(value, `${name} at p=0`).toBe(0);
    }
  });

  it("holds the slab AND the Listening row at full opacity by t=.5 (r4 finding 5)", () => {
    // The load-bearing frame of the whole transition. At the pre-v5 windows
    // (slab .18-.58, row .45-.55) this freeze showed a half-resolved panel
    // with a half-opacity row in it: 2.46:1, which is "visible" only in the
    // sense that a pixel differs. Both at 1.0 measures ~5.9:1 — above the 4.5
    // floor the rest of the system holds. Narrated must mean legible.
    const half = phase(0.5, "desktop");
    expect(half.slab).toBe(1);
    expect(half.listen).toBe(1);
  });

  it("lets the pane's edge pass before its words arrive (r3 finding 7a)", () => {
    // Glass arrives, then words condense. If the text started with the pane,
    // every frame between .44 and .60 would show words clipped in half by the
    // pane's own leading edge.
    expect(DESKTOP_BEATS.laneText.from).toBeGreaterThan(DESKTOP_BEATS.lane.from);
    const edge = phase(DESKTOP_BEATS.lane.from + 0.05, "desktop");
    expect(edge.lane).toBeGreaterThan(0);
    expect(edge.laneText).toBe(0);
  });

  it("writes the first call only after the badge has started saying who is here", () => {
    // Causality at every freeze: the row is the call's *content*, and no
    // frame may show content before the page has admitted an agent arrived.
    expect(DESKTOP_BEATS.row.from).toBeGreaterThan(DESKTOP_BEATS.badge.from);
    const midBadge = phase(0.7, "desktop");
    expect(midBadge.badge).toBeGreaterThan(0);
    expect(midBadge.row).toBe(0);
  });

  it("keeps the caption to the last beat, so the toast is the story's landing", () => {
    // The caption is a toast, not a subtitle: it blooms as the transition ends
    // and then dwells on its own clock. Anything earlier narrates a story the
    // viewer is still watching.
    expect(phase(0.89, "desktop").caption).toBe(0);
    expect(phase(0.9, "desktop").caption).toBe(0);
    expect(phase(1, "desktop").caption).toBe(1);
  });

  it("clears the landing hint before any agent chrome is on screen", () => {
    // The hint says "tap Places to browse" — a sentence about a page that is
    // in the middle of stopping being that page.
    expect(phase(0.1, "desktop").hint).toBe(1);
    expect(phase(0.1, "desktop").slab).toBe(0);
  });
});

describe("the 390px storyboard", () => {
  it("has every beat complete at p=1", () => {
    for (const [name, value] of Object.entries(phase(1, "mobile"))) {
      expect(value, `${name} at p=1`).toBe(1);
    }
  });

  it("carries the early freezes on a longer flare than the desktop's", () => {
    // The ripple's ring is off a 390px viewport within a few frames; without
    // the longer flare, t=.15 on a phone is a still of nothing happening.
    expect(MOBILE_BEATS.flare.to).toBeGreaterThan(DESKTOP_BEATS.flare.to);
    // t=.15: the desktop's flare has already burned out (its window closed at
    // .14, and the ripple it handed off to still fills a 1440px frame); the
    // phone's is near its peak, because on that frame there is nothing else.
    expect(flash(0.15, DESKTOP_BEATS.flare)).toBeCloseTo(0, 6);
    expect(flash(0.15, MOBILE_BEATS.flare)).toBeGreaterThan(0.8);
  });

  it("finishes typing the first call before the sheet lands", () => {
    // The sheet rises *quiet*: it is the second half of the story, and it must
    // not arrive on top of a sentence still being written.
    expect(MOBILE_BEATS.type.to).toBeLessThan(MOBILE_BEATS.sheet.to);
    expect(phase(0.55, "mobile").type).toBe(1);
    expect(phase(0.55, "mobile").sheet).toBeLessThan(1);
  });

  it("gives the bottom band no beat of its own: it rides the sheet that takes it", () => {
    // The band (legend, attribution, badge, dock) is displaced by the sheet and
    // by nothing else on this tier, so it travels on the sheet's own progress —
    // any separate window would put the two out of step, and a band that
    // arrived early would sit in mid-air over a sheet still rising.
    const mobile = phase(0.5, "mobile") as Record<string, number>;
    expect(mobile.band).toBeUndefined();
    expect(MOBILE_BEATS.sheet.from).toBeGreaterThanOrEqual(MOBILE_BEATS.ticker.to);
  });

  it("has no desktop-only beat: the sheet tier has no slab, lane or sheen", () => {
    // Not a hole in one shared object — a phone runs a different story, and
    // asking it for `slab` should not typecheck or resolve.
    const mobile = phase(0.5, "mobile") as Record<string, number>;
    expect(mobile.slab).toBeUndefined();
    expect(mobile.lane).toBeUndefined();
    expect(mobile.sheen).toBeUndefined();
  });
});

describe("the ticker's typewriter", () => {
  it("is monotonic and quantised, so the same t always types the same prefix", () => {
    // Freezes have to be reproducible: a screenshot at t=.4 must show the same
    // characters on every run, or the frame-exact reference is worthless.
    expect(typedChars(30, 0)).toBe(0);
    expect(typedChars(30, 1)).toBe(30);
    expect(typedChars(30, 0.5)).toBe(15);
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const now = typedChars(30, t);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });

  it("never runs past the end of the summary it is typing", () => {
    expect(typedChars(12, 4)).toBe(12);
    expect(typedChars(12, -4)).toBe(0);
  });
});
