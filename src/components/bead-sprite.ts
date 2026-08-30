/**
 * The glass bead — the mark GlassMap puts on a place somebody acted on.
 *
 * Three aligned cues carry provenance, because one does not survive a 1x
 * screen: a pale core **wash**, a deep 2 px **rim**, and a bright, soft
 * **glow**. Teal is the agent, rose is the human — the same two colours the
 * drawings already use (`DRAWING_COLOR`), so the grammar is one grammar.
 *
 * Why a baked sprite and not a stack of circle layers: a MapLibre `circle`
 * has one flat fill and one hard stroke, so it cannot do the multi-stop
 * radial wash that makes the bead read as glass, and it cannot drop a shadow
 * under itself. (`circle-blur` does exist — but it softens the one edge a
 * circle has, which is not a wash under a rim under a glow.) Assembling the
 * three cues out of circles would cost four layers per provenance and still
 * lose the pearl; this is one image.
 *
 * The glow obeys the colour-law amendment signed off on 2026-08-30: a bright
 * hue may be baked into a persistent mark only while it is **static, blurred
 * and alpha <= .55**. It is painted here as a radial-gradient annulus rather
 * than through `ctx.filter = "blur()"`: the gradient is blur by construction,
 * so the amendment holds on every canvas implementation instead of only on
 * the ones that support filters.
 */
import { DRAWING_COLOR } from "./drawing-style";

/** Who put the mark there. The same two words `Drawing["source"]` uses. */
export type Provenance = "agent" | "user";

export const PROVENANCES: readonly Provenance[] = ["agent", "user"];

/**
 * The bright hue of the glow. Deliberately *not* the rim colour: the rim is
 * the deep ink that survives a greyscale print, the glow is the light around
 * it, and a mark needs both to be legible over a pale street and a dark park.
 */
export const GLOW_COLOR: Record<Provenance, string> = {
  agent: "#2dd4bf",
  user: "#f48fb1",
};

/** The amendment's ceiling. Asserted by the unit tests, not just documented. */
export const GLOW_ALPHA = 0.55;

/** The deep rim: the provenance ink itself. */
export const RIM_COLOR: Record<Provenance, string> = DRAWING_COLOR;

/** The pearl wash, centre to edge. */
const CORE_STOPS: Record<Provenance, readonly [string, string, string]> = {
  agent: ["#ffffff", "#e9f7f5", "#b7ded9"],
  user: ["#ffffff", "#fcedf2", "#eac3d1"],
};

/** The ink at the centre of a single bead, and the shadow under every bead. */
const INK_COLOR = "#17202a";
const SHADOW_COLOR = "rgba(10, 13, 18, 0.45)";

/**
 * The radius every other dimension is a proportion of. The design fixed the
 * bead at r = 7.5 with a 2 px rim; keeping that ratio means the bead is the
 * same drawing at every size instead of a different one per zoom.
 */
export const BEAD_UNIT = 7.5;

/**
 * The radius the sprites are baked at. Every displayed size is this image
 * scaled by `icon-size`, so it has to be at least as large as the biggest
 * bead on the map (a 15 px cluster) — downscaling is clean, upscaling is mush.
 */
export const BEAD_BAKE_RADIUS = 16;

/** Baked at 2x so the bead stays crisp on a retina screen. */
export const BEAD_SPRITE_PIXEL_RATIO = 2;

/**
 * What each sprite is:
 *  - `bead`    a single acted-on place: wash, rim, ink centre, specular.
 *  - `cluster` several of them coalesced: same body, no ink centre — the
 *              count numeral is drawn by the symbol layer's `text-field`, so
 *              one image serves every count instead of one image per number.
 *  - `ring`    a bundled feature's selection ring: the same glow and rim
 *              around a transparent core, so the category colour underneath
 *              (which the legend promises) still shows through.
 */
export type BeadKind = "bead" | "cluster" | "ring";

export const BEAD_KINDS: readonly BeadKind[] = ["bead", "cluster", "ring"];

/** The `map.addImage` name of one sprite. */
export const beadImageId = (kind: BeadKind, provenance: Provenance): string =>
  `gm-${kind}-${provenance}`;

/** Every sprite the map has to have loaded before the bead layers are added. */
export const BEAD_IMAGE_IDS: readonly string[] = BEAD_KINDS.flatMap((kind) =>
  PROVENANCES.map((provenance) => beadImageId(kind, provenance)),
);

/** Rim width, in mockup units (scaled by radius / BEAD_UNIT when painted). */
const RIM_WIDTH: Record<BeadKind, number> = { bead: 2, cluster: 2.4, ring: 2.5 };

/**
 * Half the sprite's edge length, in CSS pixels: the bead plus the glow's tail
 * plus the shadow's. Written as a proportion so it holds at any bake radius.
 */
export const beadSpriteHalfSize = (radius: number): number => Math.ceil(radius * 2.2);

/**
 * Paint one bead, centred, in CSS pixels. `ctx` must already be scaled for the
 * device pixel ratio.
 */
export function paintBead(
  ctx: CanvasRenderingContext2D,
  kind: BeadKind,
  provenance: Provenance,
  radius: number,
  centre: number,
): void {
  const k = radius / BEAD_UNIT;

  // 1 · the glow. A radial annulus: transparent inside the bead, peaking just
  //     outside the rim at GLOW_ALPHA, gone by the sprite's edge. Static and
  //     blurred by construction — the amendment's two conditions.
  const inner = Math.max(0, radius - 3 * k);
  const outer = radius + 6 * k;
  const glow = ctx.createRadialGradient(centre, centre, inner, centre, centre, outer);
  const peak = (radius + 2.2 * k - inner) / (outer - inner);
  const bright = GLOW_COLOR[provenance];
  glow.addColorStop(0, withAlpha(bright, 0));
  glow.addColorStop(peak * 0.55, withAlpha(bright, GLOW_ALPHA * 0.35));
  glow.addColorStop(peak, withAlpha(bright, GLOW_ALPHA));
  glow.addColorStop(peak + (1 - peak) * 0.45, withAlpha(bright, GLOW_ALPHA * 0.4));
  glow.addColorStop(1, withAlpha(bright, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centre, centre, outer, 0, Math.PI * 2);
  ctx.fill();

  // 2 · the body, lifted off the map by a soft shadow.
  ctx.save();
  ctx.shadowColor = SHADOW_COLOR;
  ctx.shadowBlur = 1.6 * k;
  ctx.shadowOffsetY = 1.2 * k;
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  if (kind === "ring") {
    // No fill: the ring is a casing around whatever the map already drew, so
    // its white is a stroke and the shadow hangs off that.
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 5 * k;
    ctx.stroke();
  } else {
    const wash = ctx.createRadialGradient(
      centre - radius * 0.3,
      centre - radius * 0.4,
      0,
      centre,
      centre,
      radius * 1.15,
    );
    const stops = CORE_STOPS[provenance];
    wash.addColorStop(0, stops[0]);
    wash.addColorStop(0.55, stops[1]);
    wash.addColorStop(1, stops[2]);
    ctx.fillStyle = wash;
    ctx.fill();
  }
  ctx.restore();

  // 3 · the rim: the one cue that survives a greyscale screenshot.
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.strokeStyle = RIM_COLOR[provenance];
  ctx.lineWidth = RIM_WIDTH[kind] * k;
  ctx.stroke();

  if (kind !== "bead") return;

  // 4 · the ink centre and the specular highlight — what makes it a bead and
  //     not a button. A counted cluster leaves this space to its numeral.
  ctx.fillStyle = INK_COLOR;
  ctx.beginPath();
  ctx.arc(centre, centre, Math.max(1.6, radius * 0.3), 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(centre, centre);
  ctx.rotate((-32 * Math.PI) / 180);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(-radius * 0.32, -radius * 0.4, radius * 0.3, radius * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** `#rrggbb` plus an alpha, as `rgba()`. The glow's stops are the only user. */
function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** One `map.addImage` call's arguments. */
export interface BeadImage {
  id: string;
  image: ImageData;
  pixelRatio: number;
}

/**
 * Render every bead sprite once.
 *
 * Browser-only: it needs a 2D canvas. Returns an empty list when there is no
 * context to draw on (a headless run with no GPU, where the map itself never
 * loads either), so the caller never has to special-case it.
 */
export function createBeadImages(
  radius = BEAD_BAKE_RADIUS,
  ratio = BEAD_SPRITE_PIXEL_RATIO,
): BeadImage[] {
  const half = beadSpriteHalfSize(radius);
  const size = half * 2;
  const out: BeadImage[] = [];
  for (const kind of BEAD_KINDS) {
    for (const provenance of PROVENANCES) {
      const canvas = document.createElement("canvas");
      canvas.width = size * ratio;
      canvas.height = size * ratio;
      const ctx = canvas.getContext("2d");
      if (!ctx) return [];
      ctx.scale(ratio, ratio);
      paintBead(ctx, kind, provenance, radius, half);
      out.push({
        id: beadImageId(kind, provenance),
        image: ctx.getImageData(0, 0, canvas.width, canvas.height),
        pixelRatio: ratio,
      });
    }
  }
  return out;
}
