import { describe, expect, it } from "vitest";
import {
  BEAD_BAKE_RADIUS,
  BEAD_IMAGE_IDS,
  BEAD_UNIT,
  GLOW_ALPHA,
  GLOW_COLOR,
  RIM_COLOR,
  beadImageId,
  beadSpriteHalfSize,
  paintBead,
  type BeadKind,
  type Provenance,
} from "./bead-sprite";
import { DRAWING_COLOR } from "./drawing-style";

/**
 * A canvas that writes down what was asked of it.
 *
 * The sprite is the one part of the bead system with no other net under it:
 * the e2e suite runs network-isolated, so the basemap never loads and no
 * browser test ever paints one. Recording the calls is how the amendment
 * ("static, blurred, alpha <= .55") stays a fact instead of a comment.
 */
interface Stop {
  offset: number;
  color: string;
}

interface Drawn {
  op: "fill" | "stroke";
  style: string | Stop[];
  lineWidth: number;
  radius: number | null;
}

function recorder() {
  const drawn: Drawn[] = [];
  const gradients: Stop[][] = [];
  let radius: number | null = null;
  const ctx = {
    fillStyle: "" as string | Stop[],
    strokeStyle: "" as string,
    lineWidth: 0,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    createRadialGradient(): { addColorStop: (offset: number, color: string) => void } & Stop[] {
      const stops: Stop[] = [];
      gradients.push(stops);
      return Object.assign(stops, {
        addColorStop: (offset: number, color: string) => void stops.push({ offset, color }),
      });
    },
    beginPath() {},
    arc(_x: number, _y: number, r: number) {
      radius = r;
    },
    ellipse() {
      radius = null;
    },
    fill() {
      drawn.push({ op: "fill", style: ctx.fillStyle, lineWidth: ctx.lineWidth, radius });
    },
    stroke() {
      drawn.push({ op: "stroke", style: ctx.strokeStyle, lineWidth: ctx.lineWidth, radius });
    },
    save() {},
    restore() {},
    translate() {},
    rotate() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, gradients };
}

const paint = (kind: BeadKind, provenance: Provenance, radius = BEAD_BAKE_RADIUS) => {
  const rec = recorder();
  paintBead(rec.ctx, kind, provenance, radius, beadSpriteHalfSize(radius));
  return rec;
};

const alphaOf = (color: string) => Number(color.slice(color.lastIndexOf(",") + 1, -1));

describe("the sprite set", () => {
  it("is one image per kind and provenance — six, not one per count", () => {
    expect(BEAD_IMAGE_IDS).toEqual([
      "gm-bead-agent",
      "gm-bead-user",
      "gm-cluster-agent",
      "gm-cluster-user",
      "gm-ring-agent",
      "gm-ring-user",
    ]);
    expect(beadImageId("cluster", "user")).toBe("gm-cluster-user");
  });

  it("leaves room for the glow and the shadow around the bead", () => {
    // An image cropped to the bead would clip its own glow, and the clipped
    // edge would be visible as a square around every mark.
    expect(beadSpriteHalfSize(BEAD_BAKE_RADIUS)).toBeGreaterThan(BEAD_BAKE_RADIUS);
  });
});

describe("provenance, carried three ways", () => {
  it("rims the bead in the same ink the drawings use", () => {
    // One grammar: a teal shape and a teal bead were both put there by the
    // agent, and the map must not have two vocabularies for that.
    expect(RIM_COLOR).toEqual(DRAWING_COLOR);
    expect(RIM_COLOR.agent).toBe("#0b7285");
    expect(RIM_COLOR.user).toBe("#c2255c");
  });

  it("strokes the rim in the provenance colour at every kind", () => {
    for (const kind of ["bead", "cluster", "ring"] as const) {
      for (const provenance of ["agent", "user"] as const) {
        const { drawn } = paint(kind, provenance);
        expect(drawn.some((d) => d.op === "stroke" && d.style === RIM_COLOR[provenance])).toBe(true);
      }
    }
  });

  it("washes the core in a pale tint of the same hue", () => {
    // Finding 5 of the design review: at 1x the rim alone cannot carry
    // provenance — the wash and the glow are what make it readable.
    const agent = paint("bead", "agent").gradients[1].map((s) => s.color);
    const user = paint("bead", "user").gradients[1].map((s) => s.color);
    expect(agent).not.toEqual(user);
    expect(agent[0]).toBe("#ffffff");
    expect(user[0]).toBe("#ffffff");
  });
});

describe("the glow, under the colour-law amendment", () => {
  it("never exceeds alpha .55", () => {
    // The amendment permits a bright hue on a persistent mark only while it is
    // static, blurred and alpha <= .55. This is the ceiling, checked on every
    // stop of every sprite rather than trusted to the constant.
    for (const kind of ["bead", "cluster", "ring"] as const) {
      for (const provenance of ["agent", "user"] as const) {
        for (const stop of paint(kind, provenance).gradients[0]) {
          expect(alphaOf(stop.color)).toBeLessThanOrEqual(GLOW_ALPHA);
        }
      }
    }
  });

  it("is blurred by construction: a gradient, not a hard ring", () => {
    // A radial ramp IS a blur, so the amendment holds on every canvas rather
    // than only on the ones that implement `ctx.filter`. Transparent at both
    // ends means no hard edge exists to see.
    const stops = paint("bead", "agent").gradients[0];
    expect(stops.length).toBeGreaterThanOrEqual(4);
    expect(alphaOf(stops[0].color)).toBe(0);
    expect(alphaOf(stops[stops.length - 1].color)).toBe(0);
    expect(Math.max(...stops.map((s) => alphaOf(s.color)))).toBe(GLOW_ALPHA);
  });

  it("peaks just outside the rim, in the bright hue", () => {
    const stops = paint("bead", "user").gradients[0];
    const peak = stops.find((s) => alphaOf(s.color) === GLOW_ALPHA)!;
    expect(peak.offset).toBeGreaterThan(0);
    expect(peak.offset).toBeLessThan(1);
    const bright = GLOW_COLOR.user;
    expect(bright).not.toBe(RIM_COLOR.user);
    // #f48fb1 -> rgba(244,143,177,…)
    expect(peak.color.startsWith("rgba(244,143,177")).toBe(true);
  });

  it("is drawn first, so the bead sits on the light rather than under it", () => {
    const { drawn } = paint("bead", "agent");
    expect(Array.isArray(drawn[0].style)).toBe(true);
  });
});

describe("what tells the three kinds apart", () => {
  it("gives a single bead an ink centre and a highlight", () => {
    const fills = paint("bead", "agent").drawn.filter((d) => d.op === "fill");
    expect(fills.some((d) => d.style === "#17202a")).toBe(true);
    expect(fills.some((d) => d.style === "rgba(255,255,255,0.85)")).toBe(true);
  });

  it("leaves a cluster bead's centre empty for its numeral", () => {
    // The count is a `text-field` on the symbol layer, so one image serves
    // every number. An ink dot under it would read as a full stop.
    const fills = paint("cluster", "agent").drawn.filter((d) => d.op === "fill");
    expect(fills.some((d) => d.style === "#17202a")).toBe(false);
  });

  it("leaves the ring's core transparent, so the category colour shows through", () => {
    // A ring goes over a bundled feature whose colour the legend promises;
    // filling it would make the legend lie.
    const { drawn, gradients } = paint("ring", "agent");
    expect(gradients).toHaveLength(1); // the glow only — no core wash
    expect(drawn.filter((d) => d.op === "fill")).toHaveLength(1); // the glow itself
  });

  it("keeps the white casing on the ring, which is what makes it readable", () => {
    // Over a dark park fill the deep teal alone disappears. The casing used to
    // be a second circle layer; it is now baked into the sprite.
    const { drawn } = paint("ring", "agent");
    expect(drawn.some((d) => d.op === "stroke" && d.style === "rgba(255,255,255,0.92)")).toBe(true);
  });
});

describe("scaling", () => {
  it("is the same drawing at every size", () => {
    // Every dimension is a proportion of the radius, so the sprite can be
    // baked once and scaled by `icon-size` without the rim turning into a
    // hairline at one zoom and a band at another.
    const small = paint("bead", "agent", BEAD_UNIT);
    const large = paint("bead", "agent", BEAD_UNIT * 4);
    const rim = (rec: ReturnType<typeof paint>) =>
      rec.drawn.find((d) => d.op === "stroke" && d.style === RIM_COLOR.agent)!;
    expect(rim(small).lineWidth).toBeCloseTo(2);
    expect(rim(large).lineWidth).toBeCloseTo(8);
    expect(rim(large).radius! / rim(small).radius!).toBeCloseTo(4);
  });
});
