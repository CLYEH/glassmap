/**
 * The fourteen effects: eleven tools, three human actions.
 *
 * Grammar (spec v3, unchanged since v1):
 *  - **read = gaze** — cased deep-teal geometry, transient, zero residue in ≤2 s;
 *  - **write = materialize** — the artifact draws itself on, then the shipped
 *    MapLibre layer (or DOM marker) IS the thing that persists;
 *  - **human = the same verbs in rose.**
 *
 * Every effect is `setup → render(p) → cleanup`. `render` is pure in `p` and in
 * the current camera: it re-projects from lng/lat on every frame, so a `flyTo`
 * under a running effect drags the geometry along the ground instead of leaving
 * it stranded in stale screen space. Nothing here animates with CSS keyframes;
 * the driver owns the clock so any frame can be frozen for a still.
 *
 * Geometry numbers come from the mockup's plate space (`fx-mockup-v3.html`,
 * 2200×1100 at ~2.16 m/px) through `s()`, the 0.82 plate→screen factor the
 * spec's own "11 plate px ⇒ ~9 screen px" tether note fixes. Keeping the
 * conversion visible is what makes the frames comparable to `shots-v3/`.
 */
import type { LngLat } from "@/lib/store/map-store";
import {
  bell,
  clamp01,
  fixed3,
  inOutCubic,
  inOutSine,
  lerp,
  outBack,
  outCubic,
  seg,
  stagger,
} from "./easing";
import {
  graduationCount,
  normalAlong,
  pathD,
  pathMetres,
  pointAlong,
  tetherControl,
  tetherDots,
  walkPath,
  type Pt,
} from "./geometry";
import { SELECT_BLOOM_CAP, type FxGeom, type FxName } from "./plan";
import type { FxEffect, FxNodes } from "./driver";
import {
  CASE_WHITE,
  ROSE,
  ROSE_DEEP,
  TEAL,
  TEAL_DEEP,
  divEl,
  svgEl,
  type FxContext,
  type PinParts,
} from "./surfaces";

/** Mockup plate pixels → screen pixels. See the file header. */
const s = (plate: number) => plate * 0.82;

/** The shipped selection halo's screen radius at city zooms (map-style.ts). */
const HALO_PX = 11;

type Effect<N extends FxNodes = FxNodes> = FxEffect<FxContext, N>;

// ---------------------------------------------------------------- surfaces

function mapGroup(ctx: FxContext, name: FxName): SVGGElement {
  return svgEl("g", { "data-testid": "fx-effect", "data-fx-name": name }, ctx.overlay);
}

function viewportBox(ctx: FxContext, name: FxName): HTMLDivElement {
  const box = divEl("fx-holder", ctx.viewport);
  box.dataset.testid = "fx-effect";
  box.dataset.fxName = name;
  return box;
}

/** The casing rule: white under-stroke, ink over it, so a still reads on the light basemap. */
function casedPair<K extends "circle" | "line" | "path">(
  tag: K,
  attrs: Record<string, string | number>,
  parent: Element,
  wide: number,
  narrow: number,
  ink: string,
): [SVGElementTagNameMap[K], SVGElementTagNameMap[K]] {
  const shell = svgEl(
    tag,
    { ...attrs, stroke: CASE_WHITE, "stroke-width": wide, opacity: 0.85 },
    parent,
  );
  const line = svgEl(tag, { ...attrs, stroke: ink, "stroke-width": narrow }, parent);
  return [shell, line];
}

const setOpacity = (node: Element, value: number) =>
  node.setAttribute("opacity", fixed3(clamp01(value)));

/** A group parked off screen: the camera moved somewhere this effect cannot follow. */
const hide = (node: SVGElement) => node.setAttribute("opacity", "0");

// =========================================================== read: viewport

/**
 * get_map_state — "viewfinder breath". The agent read the camera, not any
 * feature, so nothing on the DATA may move: a cased frame and corner brackets
 * over the visible corridor, one vignette breath, and the camera chip — the
 * human-readable half of the very same reading — glows once.
 */
const bracketPath = (x: number, y: number, dx: number, dy: number, size: number) =>
  `M${x + dx * size},${y} L${x},${y} L${x},${y + dy * size}`;

interface ViewfinderNodes extends FxNodes {
  root: HTMLDivElement;
  vignette: HTMLDivElement;
  frame: SVGSVGElement;
  chip: HTMLElement | null;
}

const viewfinder: Effect<ViewfinderNodes> = {
  dur: 1100,
  setup(ctx) {
    const root = viewportBox(ctx, "get_map_state");
    const { height } = ctx.size();
    const width = ctx.corridorWidth();
    const inset = 14;
    const size = 30;
    const vignette = divEl("fx-vignette", root);
    vignette.style.right = `${ctx.size().width - width}px`;
    const frame = svgEl(
      "svg",
      { class: "fx-frame", width, height, viewBox: `0 0 ${width} ${height}` },
      root,
    );
    const box = {
      x: inset,
      y: inset,
      width: Math.max(0, width - 2 * inset),
      height: Math.max(0, height - 2 * inset),
      rx: 12,
      fill: "none",
    };
    svgEl("rect", { ...box, stroke: CASE_WHITE, "stroke-width": 5, opacity: 0.85 }, frame);
    svgEl("rect", { ...box, stroke: TEAL_DEEP, "stroke-width": 2 }, frame);
    const brackets = svgEl(
      "g",
      { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" },
      frame,
    );
    for (const d of [
      bracketPath(inset, inset, 1, 1, size),
      bracketPath(width - inset, inset, -1, 1, size),
      bracketPath(inset, height - inset, 1, -1, size),
      bracketPath(width - inset, height - inset, -1, -1, size),
    ]) {
      casedPair("path", { d, fill: "none" }, brackets, 8, 3.5, TEAL_DEEP);
    }
    return { root, vignette, frame, chip: ctx.cameraChip() };
  },
  render(p, n) {
    const rise = outCubic(seg(p, 0, 0.22));
    const breathe = 0.12 * bell(seg(p, 0.22, 0.62));
    const out = inOutSine(seg(p, 0.62, 1));
    const op = (0.72 * rise - breathe) * (1 - out);
    n.vignette.style.opacity = fixed3(1.25 * op);
    n.frame.style.opacity = fixed3(1.35 * op);
    n.frame.style.transformOrigin = "50% 50%";
    n.frame.style.transform = `scale(${lerp(1.03, 1, rise).toFixed(4)})`;
    const glow = bell(seg(p, 0.05, 0.55));
    if (n.chip) {
      n.chip.style.boxShadow =
        glow > 0.01
          ? `var(--shadow), 0 0 0 1px rgba(45,212,191,${fixed3(0.4 * glow)}), 0 0 16px rgba(45,212,191,${fixed3(0.35 * glow)})`
          : "";
    }
  },
  rm(p, n) {
    const op = bell(p) * 0.6;
    n.vignette.style.opacity = fixed3(1.2 * op);
    n.frame.style.opacity = fixed3(1.3 * op);
  },
  cleanup(n) {
    n.root.remove();
    if (n.chip) n.chip.style.boxShadow = "";
  },
};

/**
 * list_features_in_view — "scan pass". One soft band crosses the corridor once,
 * like a photocopier lamp: the honest shape of "I read everything in view".
 * Viewport-space by design — the read IS about the viewport, so no camera move
 * can invalidate it.
 */
interface ScanNodes extends FxNodes {
  root: HTMLDivElement;
  band: HTMLDivElement;
  width: number;
}

const scanBand: Effect<ScanNodes> = {
  dur: 1100,
  setup(ctx) {
    const root = viewportBox(ctx, "list_features_in_view");
    const width = Math.max(120, ctx.corridorWidth() * 0.16);
    const band = divEl("fx-scanband", root);
    band.style.width = `${width}px`;
    return { root, band, width };
  },
  render(p, n, ctx) {
    const x = lerp(-n.width, ctx.corridorWidth(), inOutSine(p));
    n.band.style.transform = `translateX(${x.toFixed(1)}px)`;
    n.band.style.opacity = fixed3(seg(p, 0, 0.1) * (1 - seg(p, 0.88, 1)));
  },
  rm(p, n, ctx) {
    n.band.style.width = `${ctx.corridorWidth()}px`;
    n.band.style.background = "rgba(45,212,191,0.07)";
    n.band.style.transform = "none";
    n.band.style.opacity = fixed3(bell(p));
  },
  cleanup(n) {
    n.root.remove();
  },
};

/**
 * get_share_link — "pack to chip". The whole-state frame collapses into the
 * Share chip, which acknowledges once: the map state was packed into the link.
 * The artifact is a URL, so nothing stays on the map.
 */
interface PackNodes extends FxNodes {
  root: HTMLDivElement;
  rect: HTMLDivElement;
  chip: HTMLElement | null;
  to: { left: number; top: number; width: number; height: number };
}

const packToChip: Effect<PackNodes> = {
  dur: 1300,
  setup(ctx) {
    const chipRect = ctx.chipRect();
    if (!chipRect) return null;
    const root = viewportBox(ctx, "get_share_link");
    const rect = divEl("fx-packrect", root);
    return { root, rect, chip: ctx.chip(), to: chipRect };
  },
  render(p, n, ctx) {
    const { height } = ctx.size();
    const from = { left: 14, top: 14, width: ctx.corridorWidth() - 28, height: height - 28 };
    const move = inOutCubic(seg(p, 0.2, 0.72));
    n.rect.style.left = `${lerp(from.left, n.to.left, move).toFixed(1)}px`;
    n.rect.style.top = `${lerp(from.top, n.to.top, move).toFixed(1)}px`;
    n.rect.style.width = `${lerp(from.width, n.to.width, move).toFixed(1)}px`;
    n.rect.style.height = `${lerp(from.height, n.to.height, move).toFixed(1)}px`;
    // The rect stays visible until it REACHES the chip; the arrival is the beat.
    n.rect.style.opacity = fixed3(0.75 * seg(p, 0, 0.16) * (1 - seg(p, 0.72, 0.84)));
    const glow = bell(seg(p, 0.66, 1));
    if (n.chip) {
      n.chip.style.boxShadow =
        glow > 0.01
          ? `var(--shadow), 0 0 0 2px rgba(45,212,191,${fixed3(0.9 * glow)}), 0 0 22px rgba(45,212,191,${fixed3(0.55 * glow)}), inset 0 0 0 1px rgba(45,212,191,${fixed3(0.6 * glow)}), inset 0 0 14px rgba(45,212,191,${fixed3(0.35 * glow)})`
          : "";
    }
  },
  rm(p, n) {
    const glow = bell(p);
    if (n.chip) {
      n.chip.style.boxShadow =
        glow > 0.01
          ? `var(--shadow), 0 0 0 2px rgba(45,212,191,${fixed3(0.8 * glow)})`
          : "";
    }
  },
  cleanup(n) {
    n.root.remove();
    if (n.chip) n.chip.style.boxShadow = "";
  },
};

// ========================================================= write: the camera

/**
 * set_map_view — "flight + landing reticle". The `flyTo` itself is the
 * materialisation; the reticle collapses onto the new centre. It re-projects
 * every frame, so during the flight it rides the destination on the ground —
 * which is precisely the beat the mockup faked with a plate crossfade.
 */
interface ReticleNodes extends FxNodes {
  root: SVGGElement;
  rings: [SVGCircleElement, SVGCircleElement];
  ticks: SVGGElement;
  dot: SVGCircleElement;
  at: LngLat;
}

const reticle: Effect<ReticleNodes> = {
  dur: 1300,
  setup(ctx, geom) {
    if (geom.kind !== "reticle" || !ctx.project(geom.at)) return null;
    const root = mapGroup(ctx, "set_map_view");
    const r1 = svgEl("circle", { cx: 0, cy: 0, fill: "none", stroke: TEAL, "stroke-width": 2.5, opacity: 0 }, root);
    const r2 = svgEl("circle", { cx: 0, cy: 0, fill: "none", stroke: TEAL, "stroke-width": 1.6, opacity: 0 }, root);
    const ticks = svgEl(
      "g",
      { stroke: TEAL, "stroke-width": 2.5, "stroke-linecap": "round", opacity: 0 },
      root,
    );
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      svgEl(
        "line",
        { x1: dx * s(34), y1: dy * s(34), x2: dx * s(18), y2: dy * s(18) },
        ticks,
      );
    }
    const dot = svgEl("circle", { cx: 0, cy: 0, r: s(4), fill: TEAL, opacity: 0 }, root);
    return { root, rings: [r1, r2], ticks, dot, at: geom.at };
  },
  render(p, n, ctx) {
    const point = ctx.project(n.at);
    if (!point) return hide(n.root);
    n.root.setAttribute("opacity", "1");
    n.root.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
    const q1 = outCubic(seg(p, 0.45, 0.85));
    n.rings[0].setAttribute("r", lerp(s(120), s(26), q1).toFixed(1));
    setOpacity(n.rings[0], 0.85 * seg(p, 0.45, 0.58) * (1 - seg(p, 0.86, 1)));
    const q2 = outCubic(seg(p, 0.52, 0.9));
    n.rings[1].setAttribute("r", lerp(s(190), s(26), q2).toFixed(1));
    setOpacity(n.rings[1], 0.55 * seg(p, 0.52, 0.64) * (1 - seg(p, 0.88, 1)));
    const t = 0.9 * seg(p, 0.6, 0.72) * (1 - seg(p, 0.88, 1));
    setOpacity(n.ticks, t);
    setOpacity(n.dot, t);
  },
  rm(p, n, ctx) {
    const point = ctx.project(n.at);
    if (!point) return hide(n.root);
    n.root.setAttribute("opacity", "1");
    n.root.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
    n.rings[0].setAttribute("r", String(s(26)));
    setOpacity(n.rings[0], 0);
    setOpacity(n.rings[1], 0);
    setOpacity(n.ticks, bell(p) * 0.8);
    setOpacity(n.dot, bell(p) * 0.8);
  },
  cleanup(n) {
    n.root.remove();
  },
};

// ======================================================= read: the map itself

/**
 * find_features — "interest pulse + glints". The queried shape pulses once —
 * being inspected — and each hit glints as a HOLLOW cased dot, nearest first.
 * Hollow is the whole point: a read selects nothing and leaves nothing.
 */
interface FindNodes extends FxNodes {
  root: SVGGElement;
  outline: SVGCircleElement | SVGPathElement | null;
  fill: SVGCircleElement | SVGPathElement | null;
  glints: { g: SVGGElement; at: LngLat }[];
  shape: Extract<FxGeom, { kind: "find" }>["shape"];
  stagger: number;
}

const findPulse: Effect<FindNodes> = {
  dur: 1600,
  setup(ctx, geom) {
    if (geom.kind !== "find") return null;
    const probe = geom.shape
      ? geom.shape.type === "circle"
        ? geom.shape.at
        : geom.shape.positions[0]
      : geom.hits[0];
    if (!probe || !ctx.project(probe)) return null;
    const root = mapGroup(ctx, "find_features");
    let outline: SVGCircleElement | SVGPathElement | null = null;
    let fill: SVGCircleElement | SVGPathElement | null = null;
    if (geom.shape?.type === "circle") {
      fill = svgEl("circle", { cx: 0, cy: 0, r: 0, fill: TEAL, opacity: 0 }, root);
      outline = svgEl("circle", { cx: 0, cy: 0, r: 0, fill: "none", stroke: TEAL, opacity: 0 }, root);
    } else if (geom.shape?.type === "path") {
      fill = svgEl("path", { d: "", fill: TEAL, opacity: 0 }, root);
      outline = svgEl("path", { d: "", fill: "none", stroke: TEAL, opacity: 0 }, root);
    }
    const glints = geom.hits.map((at) => {
      const g = svgEl("g", { opacity: 0 }, root);
      casedPair("circle", { cx: 0, cy: 0, r: s(8), fill: "none" }, g, 5.5, 3, TEAL_DEEP);
      return { g, at };
    });
    return { root, outline, fill, glints, shape: geom.shape, stagger: stagger(glints.length) };
  },
  render(p, n, ctx) {
    const pulse = bell(seg(p, 0, 0.5));
    if (n.shape?.type === "circle" && n.outline && n.fill) {
      const point = ctx.project(n.shape.at);
      const radius = ctx.radiusPx(n.shape.at, n.shape.radius_m);
      if (point && radius) {
        for (const node of [n.outline, n.fill]) {
          node.setAttribute("cx", point.x.toFixed(1));
          node.setAttribute("cy", point.y.toFixed(1));
          node.setAttribute("r", radius.toFixed(1));
        }
      }
    } else if (n.shape?.type === "path" && n.outline && n.fill) {
      const points = n.shape.positions.map((at) => ctx.project(at));
      if (points.every((q): q is Pt => q !== null)) {
        const d = pathD(points, n.shape.closed);
        n.outline.setAttribute("d", d);
        n.fill.setAttribute("d", d);
      }
    }
    if (n.outline) {
      setOpacity(n.outline, 0.9 * pulse);
      n.outline.setAttribute("stroke-width", (2 + 1.5 * pulse).toFixed(2));
    }
    if (n.fill) setOpacity(n.fill, 0.07 * bell(seg(p, 0.05, 0.45)));
    n.glints.forEach((glint, i) => {
      const point = ctx.project(glint.at);
      if (!point) return hide(glint.g);
      glint.g.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
      const start = 0.3 + i * n.stagger;
      setOpacity(glint.g, bell(seg(p, start, start + 0.32)));
    });
  },
  rm(p, n, ctx) {
    const op = bell(p);
    if (n.outline) setOpacity(n.outline, 0.7 * op);
    if (n.fill) setOpacity(n.fill, 0);
    n.glints.forEach((glint) => {
      const point = ctx.project(glint.at);
      if (!point) return hide(glint.g);
      glint.g.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
      setOpacity(glint.g, 0.9 * op);
    });
  },
  cleanup(n) {
    n.root.remove();
  },
};

/**
 * describe_surroundings — "compass sweep". A beam does one clockwise rotation
 * inside the radius the tool answered with; the eight cased ticks glint as it
 * passes and N/E/S/W name themselves — the very words the result uses.
 */
const CARDINALS: Record<number, string> = { 0: "N", 2: "E", 4: "S", 6: "W" };

interface CompassNodes extends FxNodes {
  root: SVGGElement;
  ring: SVGGElement;
  ringCircles: SVGCircleElement[];
  ticks: { g: SVGGElement; ink: SVGLineElement; flash: SVGLineElement; lines: SVGLineElement[]; text: SVGTextElement | null; angle: number }[];
  wedge: SVGGElement;
  beam: SVGElement[];
  dot: SVGGElement;
  at: LngLat;
  radius_m: number;
}

const compass: Effect<CompassNodes> = {
  dur: 1800,
  setup(ctx, geom) {
    if (geom.kind !== "compass") return null;
    if (!ctx.project(geom.at) || !ctx.radiusPx(geom.at, geom.radius_m)) return null;
    const root = mapGroup(ctx, "describe_surroundings");
    const ring = svgEl("g", { opacity: 0 }, root);
    const ringCircles = [
      svgEl("circle", { r: 0, fill: "none", stroke: CASE_WHITE, "stroke-width": 4, opacity: 0.75 }, ring),
      svgEl("circle", { r: 0, fill: "none", stroke: TEAL_DEEP, "stroke-width": 1.8 }, ring),
    ];
    const ticks: CompassNodes["ticks"] = [];
    for (let k = 0; k < 8; k += 1) {
      const angle = (k * 45 * Math.PI) / 180;
      const g = svgEl("g", { opacity: 0 }, root);
      const [shell, ink] = casedPair(
        "line",
        { x1: 0, y1: 0, x2: 0, y2: 0, "stroke-linecap": "round" },
        g,
        7,
        3,
        TEAL_DEEP,
      );
      const flash = svgEl(
        "line",
        { x1: 0, y1: 0, x2: 0, y2: 0, stroke: CASE_WHITE, "stroke-width": 2.5, "stroke-linecap": "round", opacity: 0 },
        g,
      );
      let text: SVGTextElement | null = null;
      if (CARDINALS[k]) {
        text = svgEl(
          "text",
          {
            x: 0,
            y: 0,
            "text-anchor": "middle",
            "font-size": 15,
            "font-weight": 600,
            fill: TEAL_DEEP,
            stroke: CASE_WHITE,
            "stroke-width": 3,
            "paint-order": "stroke",
            style: "font-family: var(--font-mono)",
          },
          g,
        );
        text.textContent = CARDINALS[k];
      }
      ticks.push({ g, ink, flash, lines: [shell, ink, flash], text, angle });
    }
    const wedge = svgEl("g", { opacity: 0 }, root);
    const beam: SVGElement[] = [
      svgEl("path", { d: "", fill: TEAL, opacity: 0.18 }, wedge),
      svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 0, stroke: TEAL, "stroke-width": 2, opacity: 0.4, transform: "rotate(-14)" }, wedge),
      svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 0, stroke: CASE_WHITE, "stroke-width": 5, opacity: 0.85 }, wedge),
      svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 0, stroke: TEAL_DEEP, "stroke-width": 2 }, wedge),
    ];
    const dot = svgEl("g", { opacity: 0 }, root);
    svgEl("circle", { r: 6, fill: CASE_WHITE, opacity: 0.9 }, dot);
    svgEl("circle", { r: 4, fill: TEAL_DEEP }, dot);
    return { root, ring, ringCircles, ticks, wedge, beam, dot, at: geom.at, radius_m: geom.radius_m };
  },
  render(p, n, ctx) {
    const point = ctx.project(n.at);
    const R = ctx.radiusPx(n.at, n.radius_m);
    if (!point || !R) return hide(n.root);
    n.root.setAttribute("opacity", "1");
    n.root.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
    for (const circle of n.ringCircles) circle.setAttribute("r", R.toFixed(1));
    const env = seg(p, 0, 0.12) * (1 - seg(p, 0.86, 1));
    setOpacity(n.ring, 0.7 * env);
    setOpacity(n.dot, env);
    const deg = 360 * inOutSine(seg(p, 0.08, 0.84));
    n.wedge.setAttribute("transform", `rotate(${deg.toFixed(2)})`);
    setOpacity(n.wedge, env);
    const wx = -R * Math.sin((32 * Math.PI) / 180);
    const wy = -R * Math.cos((32 * Math.PI) / 180);
    n.beam[0].setAttribute("d", `M0,0 L${wx.toFixed(1)},${wy.toFixed(1)} A${R.toFixed(1)},${R.toFixed(1)} 0 0 1 0,${(-R).toFixed(1)} Z`);
    for (const line of n.beam.slice(1)) line.setAttribute("y2", (-R).toFixed(1));
    n.ticks.forEach((tick, k) => {
      const sx = Math.sin(tick.angle);
      const cy = -Math.cos(tick.angle);
      for (const line of tick.lines) {
        line.setAttribute("x1", (sx * (R - 11)).toFixed(1));
        line.setAttribute("y1", (cy * (R - 11)).toFixed(1));
        line.setAttribute("x2", (sx * (R + 11)).toFixed(1));
        line.setAttribute("y2", (cy * (R + 11)).toFixed(1));
      }
      if (tick.text) {
        tick.text.setAttribute("x", (sx * (R + 28)).toFixed(1));
        tick.text.setAttribute("y", (cy * (R + 28) + 5).toFixed(1));
      }
      const glow = deg >= k * 45 ? Math.exp(-(deg - k * 45) / 40) : 0;
      setOpacity(tick.g, (0.55 + 0.45 * glow) * env);
      tick.ink.setAttribute("stroke-width", (3 + 1.8 * glow).toFixed(2));
      setOpacity(tick.flash, 0.9 * glow * glow);
    });
  },
  rm(p, n, ctx) {
    const point = ctx.project(n.at);
    const R = ctx.radiusPx(n.at, n.radius_m);
    if (!point || !R) return hide(n.root);
    n.root.setAttribute("opacity", "1");
    n.root.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
    for (const circle of n.ringCircles) circle.setAttribute("r", R.toFixed(1));
    const op = bell(p);
    setOpacity(n.ring, 0.6 * op);
    setOpacity(n.dot, op);
    setOpacity(n.wedge, 0);
    n.ticks.forEach((tick) => {
      const sx = Math.sin(tick.angle);
      const cy = -Math.cos(tick.angle);
      for (const line of tick.lines) {
        line.setAttribute("x1", (sx * (R - 11)).toFixed(1));
        line.setAttribute("y1", (cy * (R - 11)).toFixed(1));
        line.setAttribute("x2", (sx * (R + 11)).toFixed(1));
        line.setAttribute("y2", (cy * (R + 11)).toFixed(1));
      }
      if (tick.text) {
        tick.text.setAttribute("x", (sx * (R + 28)).toFixed(1));
        tick.text.setAttribute("y", (cy * (R + 28) + 5).toFixed(1));
      }
      setOpacity(tick.g, 0.7 * op);
      setOpacity(tick.flash, 0);
    });
  },
  cleanup(n) {
    n.root.remove();
  },
};

/**
 * compare_areas — "twin ping + tether". Two rings at the SAME radius (the
 * shared radius is the tool's whole semantic) with a joint pulse, joined by a
 * chain of cased dots on a bowed arc that grows inward from BOTH ends: no
 * direction of travel, and a smooth bow is as far from a street-following
 * route as a mark on a map can get.
 */
interface TwinNodes extends FxNodes {
  root: SVGGElement;
  sides: { g: SVGGElement; ring: SVGCircleElement[]; ink: SVGCircleElement; dot: SVGGElement; at: LngLat }[];
  tether: SVGGElement;
  dots: SVGGElement[];
  radius_m: number;
}

function makeTetherDot(parent: SVGGElement): SVGGElement {
  const g = svgEl("g", { opacity: 0 }, parent);
  svgEl("circle", { cx: 0, cy: 0, r: 3.4, fill: CASE_WHITE, opacity: 0.85 }, g);
  svgEl("circle", { cx: 0, cy: 0, r: 1.85, fill: TEAL_DEEP }, g);
  return g;
}

const twinPing: Effect<TwinNodes> = {
  dur: 1800,
  setup(ctx, geom) {
    if (geom.kind !== "twin") return null;
    if (!ctx.project(geom.a) || !ctx.project(geom.b)) return null;
    const root = mapGroup(ctx, "compare_areas");
    const tether = svgEl("g", { opacity: 0 }, root);
    const side = (at: LngLat) => {
      const g = svgEl("g", { opacity: 0 }, root);
      const shell = svgEl("circle", { cx: 0, cy: 0, r: 0, fill: "none", stroke: CASE_WHITE, "stroke-width": 5, opacity: 0.75 }, g);
      const ink = svgEl("circle", { cx: 0, cy: 0, r: 0, fill: "none", stroke: TEAL_DEEP, "stroke-width": 2.5 }, g);
      const dot = svgEl("g", { opacity: 0 }, root);
      svgEl("circle", { cx: 0, cy: 0, r: 6, fill: CASE_WHITE, opacity: 0.9 }, dot);
      svgEl("circle", { cx: 0, cy: 0, r: 4, fill: TEAL_DEEP }, dot);
      return { g, ring: [shell, ink], ink, dot, at };
    };
    return {
      root,
      sides: [side(geom.a), side(geom.b)],
      tether,
      dots: [],
      radius_m: geom.radius_m,
    };
  },
  render(p, n, ctx) {
    const points = n.sides.map((side) => ctx.project(side.at));
    const R = ctx.radiusPx(n.sides[0].at, n.radius_m);
    if (!points[0] || !points[1] || !R) return hide(n.root);
    n.root.setAttribute("opacity", "1");
    const fade = 1 - seg(p, 0.84, 1);
    const joint = bell(seg(p, 0.6, 0.82));
    n.sides.forEach((side, i) => {
      const point = points[i]!;
      const t0 = i * 0.14;
      const q = outCubic(seg(p, t0, t0 + 0.32));
      const place = `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`;
      side.g.setAttribute("transform", place);
      side.dot.setAttribute("transform", place);
      for (const circle of side.ring) circle.setAttribute("r", (R * q).toFixed(1));
      setOpacity(side.g, q <= 0 ? 0 : (lerp(0.9, 0.55, q) + 0.35 * joint) * fade);
      side.ink.setAttribute("stroke-width", (2.5 + 1.2 * joint).toFixed(2));
      setOpacity(side.dot, seg(p, t0, t0 + 0.1) * fade);
    });
    const { width, height } = ctx.size();
    const control = tetherControl(points[0], points[1], width, height);
    const wanted = tetherDots(points[0], points[1], control);
    while (n.dots.length < wanted.length) n.dots.push(makeTetherDot(n.tether));
    while (n.dots.length > wanted.length) n.dots.pop()?.remove();
    const count = n.dots.length;
    const half = Math.max(1, Math.ceil((count - 1) / 2));
    const grow = seg(p, 0.38, 0.62);
    n.dots.forEach((dot, k) => {
      const at = wanted[k];
      dot.setAttribute("transform", `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);
      const fromEnd = Math.min(k, count - 1 - k) / half;
      setOpacity(dot, seg(grow, fromEnd * 0.7, fromEnd * 0.7 + 0.3));
    });
    setOpacity(n.tether, 0.9 * seg(p, 0.38, 0.44) * fade);
  },
  rm(p, n, ctx) {
    const points = n.sides.map((side) => ctx.project(side.at));
    const R = ctx.radiusPx(n.sides[0].at, n.radius_m);
    if (!points[0] || !points[1] || !R) return hide(n.root);
    n.root.setAttribute("opacity", "1");
    const op = bell(p);
    n.sides.forEach((side, i) => {
      const point = points[i]!;
      const place = `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`;
      side.g.setAttribute("transform", place);
      side.dot.setAttribute("transform", place);
      for (const circle of side.ring) circle.setAttribute("r", R.toFixed(1));
      setOpacity(side.g, 0.6 * op);
      setOpacity(side.dot, op);
    });
    const { width, height } = ctx.size();
    const wanted = tetherDots(points[0], points[1], tetherControl(points[0], points[1], width, height));
    while (n.dots.length < wanted.length) n.dots.push(makeTetherDot(n.tether));
    while (n.dots.length > wanted.length) n.dots.pop()?.remove();
    n.dots.forEach((dot, k) => {
      dot.setAttribute("transform", `translate(${wanted[k].x.toFixed(1)} ${wanted[k].y.toFixed(1)})`);
      setOpacity(dot, 1);
    });
    setOpacity(n.tether, 0.6 * op);
  },
  cleanup(n) {
    n.root.remove();
  },
};

/**
 * measure — "ruler runner". A cased runner laps the measured geometry trailing
 * a comet, laying down a graduation ACROSS the path every 100 m of TRUE length.
 * Dashes run along a stroke, graduations cross it — which is what keeps measure
 * legible over the dashed drawing it is measuring.
 */
interface RulerNodes extends FxNodes {
  root: SVGGElement;
  ticks: { g: SVGGElement; lines: SVGLineElement[] }[];
  trail: SVGPathElement;
  runner: SVGPathElement[];
  positions: LngLat[];
  closed: boolean;
}

const ruler: Effect<RulerNodes> = {
  dur: 1600,
  setup(ctx, geom) {
    if (geom.kind !== "measure") return null;
    if (geom.positions.some((at) => !ctx.project(at))) return null;
    const root = mapGroup(ctx, "measure");
    const count = graduationCount(pathMetres(geom.positions, geom.closed));
    const ticks: RulerNodes["ticks"] = [];
    for (let k = 0; k < count; k += 1) {
      const g = svgEl("g", { opacity: 0 }, root);
      const [shell, ink] = casedPair(
        "line",
        { x1: 0, y1: 0, x2: 0, y2: 0, "stroke-linecap": "round" },
        g,
        4.5,
        2,
        TEAL_DEEP,
      );
      ticks.push({ g, lines: [shell, ink] });
    }
    const trail = svgEl("path", { d: "", fill: "none", stroke: TEAL, "stroke-width": 2.5, "stroke-linecap": "round", opacity: 0 }, root);
    const runner = [
      svgEl("path", { d: "", fill: "none", stroke: CASE_WHITE, "stroke-width": 7, "stroke-linecap": "round", opacity: 0 }, root),
      svgEl("path", { d: "", fill: "none", stroke: TEAL, "stroke-width": 3.6, "stroke-linecap": "round", opacity: 0 }, root),
    ];
    return { root, ticks, trail, runner, positions: geom.positions, closed: geom.closed };
  },
  render(p, n, ctx) {
    const points = n.positions.map((at) => ctx.project(at));
    if (!points.every((q): q is Pt => q !== null)) return hide(n.root);
    n.root.setAttribute("opacity", "1");
    const walk = walkPath(points, n.closed);
    const d = pathD(points, n.closed);
    const total = walk.total || 1;
    const env = seg(p, 0, 0.12) * (1 - seg(p, 0.86, 1));
    const run = inOutCubic(seg(p, 0.06, 0.84));
    const head = total * run;
    const runnerLen = Math.min(90, total * 0.25);
    for (const node of n.runner) {
      node.setAttribute("d", d);
      node.setAttribute("stroke-dasharray", `${runnerLen.toFixed(1)} ${(total - runnerLen).toFixed(1)}`);
      node.setAttribute("stroke-dashoffset", (-head).toFixed(1));
    }
    setOpacity(n.runner[0], 0.75 * env);
    setOpacity(n.runner[1], 0.95 * env);
    const tail = Math.min(total * 0.35, head);
    n.trail.setAttribute("d", d);
    n.trail.setAttribute("stroke-dasharray", `${tail.toFixed(1)} ${(total - tail).toFixed(1)}`);
    n.trail.setAttribute("stroke-dashoffset", (-(head - tail)).toFixed(1));
    setOpacity(n.trail, 0.3 * env);
    n.ticks.forEach((tick, k) => {
      const at = (k / n.ticks.length) * total;
      const point = pointAlong(walk, at);
      const normal = normalAlong(walk, at);
      for (const line of tick.lines) {
        line.setAttribute("x1", (point.x - normal.x * 7).toFixed(1));
        line.setAttribute("y1", (point.y - normal.y * 7).toFixed(1));
        line.setAttribute("x2", (point.x + normal.x * 7).toFixed(1));
        line.setAttribute("y2", (point.y + normal.y * 7).toFixed(1));
      }
      const reach = k / n.ticks.length;
      setOpacity(tick.g, 0.8 * outCubic(seg(run, reach, reach + 0.03)) * env);
    });
  },
  rm(p, n, ctx) {
    const points = n.positions.map((at) => ctx.project(at));
    if (!points.every((q): q is Pt => q !== null)) return hide(n.root);
    n.root.setAttribute("opacity", "1");
    const walk = walkPath(points, n.closed);
    const total = walk.total || 1;
    const op = bell(p);
    for (const node of n.runner) setOpacity(node, 0);
    setOpacity(n.trail, 0);
    n.ticks.forEach((tick, k) => {
      const at = (k / n.ticks.length) * total;
      const point = pointAlong(walk, at);
      const normal = normalAlong(walk, at);
      for (const line of tick.lines) {
        line.setAttribute("x1", (point.x - normal.x * 7).toFixed(1));
        line.setAttribute("y1", (point.y - normal.y * 7).toFixed(1));
        line.setAttribute("x2", (point.x + normal.x * 7).toFixed(1));
        line.setAttribute("y2", (point.y + normal.y * 7).toFixed(1));
      }
      setOpacity(tick.g, 0.7 * op);
    });
  },
  cleanup(n) {
    n.root.remove();
  },
};

// ========================================================= write: the artifact

/**
 * select_features — "halo drop-in". The persistent artifact is the SHIPPED
 * selection layer, which is already on the map when this runs; what the effect
 * adds is the landing — a cased ring settling onto each anchor, nearest first,
 * with a bloom behind it — and then gets out of the way entirely.
 *
 * The N-scaling law bounds both axes: the stagger fits inside 35% of the
 * timeline however large the selection, and only the 30 nearest bloom.
 */
interface SelectNodes extends FxNodes {
  root: SVGGElement;
  items: { g: SVGGElement; ring: SVGCircleElement[]; bloom: SVGCircleElement; at: LngLat }[];
  stagger: number;
}

const selectDropIn: Effect<SelectNodes> = {
  dur: 1400,
  setup(ctx, geom) {
    if (geom.kind !== "select" || geom.points.length === 0) return null;
    const visible = geom.points.slice(0, SELECT_BLOOM_CAP).filter((at) => ctx.project(at));
    if (visible.length === 0) return null;
    const root = mapGroup(ctx, "select_features");
    const items = visible.map((at) => {
      const g = svgEl("g", { opacity: 0 }, root);
      const bloom = svgEl("circle", { cx: 0, cy: 0, r: 0, fill: "none", stroke: TEAL, "stroke-width": 2.5, opacity: 0 }, g);
      const [shell, ink] = casedPair("circle", { cx: 0, cy: 0, r: HALO_PX, fill: "none" }, g, 4, 2, TEAL_DEEP);
      return { g, ring: [shell, ink], bloom, at };
    });
    return { root, items, stagger: stagger(items.length) };
  },
  render(p, n, ctx) {
    n.root.setAttribute("opacity", "1");
    n.items.forEach((item, i) => {
      const point = ctx.project(item.at);
      if (!point) return hide(item.g);
      item.g.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
      const start = i * n.stagger;
      const local = seg(p, start, start + 0.42);
      const scale = local <= 0 ? 2.1 : lerp(2.1, 1, outBack(local));
      for (const circle of item.ring) circle.setAttribute("r", (HALO_PX * scale).toFixed(1));
      // The landing ring hands the map back to the shipped halo underneath it.
      setOpacity(item.g, Math.min(1, local * 2.4) * (1 - seg(p, start + 0.5, start + 0.8)));
      const bloom = seg(p, start + 0.16, start + 0.62);
      item.bloom.setAttribute("r", lerp(s(16), s(36), outCubic(bloom)).toFixed(1));
      setOpacity(item.bloom, 0.65 * bell(bloom));
    });
  },
  rm(p, n, ctx) {
    const op = bell(p);
    n.items.forEach((item) => {
      const point = ctx.project(item.at);
      if (!point) return hide(item.g);
      item.g.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
      for (const circle of item.ring) circle.setAttribute("r", String(HALO_PX));
      setOpacity(item.g, 0.8 * op);
      setOpacity(item.bloom, 0);
    });
  },
  cleanup(n) {
    n.root.remove();
  },
};

/**
 * draw_shape / human_draw — "ink draw-on". The outline strokes itself on with a
 * pen dot riding the tip, then hands the map over to the shipped drawing layer
 * underneath. The agent inks in teal; a person inks in rose, and the corners
 * they clicked pop as the pen reaches them.
 */
interface InkNodes extends FxNodes {
  root: SVGGElement;
  path: SVGPathElement;
  pen: SVGCircleElement;
  verts: SVGCircleElement[];
  positions: LngLat[];
  closed: boolean;
}

function inkEffect(name: FxName, ink: string, withVertices: boolean, dur: number): Effect<InkNodes> {
  return {
    dur,
    setup(ctx, geom) {
      if (geom.kind !== "path" || geom.positions.length < 2) return null;
      if (geom.positions.some((at) => !ctx.project(at))) return null;
      const root = mapGroup(ctx, name);
      const path = svgEl(
        "path",
        { d: "", fill: "none", stroke: ink, "stroke-width": 2.6, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: 0.95 },
        root,
      );
      const verts = withVertices
        ? geom.positions.map(() =>
            svgEl("circle", { cx: 0, cy: 0, r: 3.7, fill: ink, stroke: CASE_WHITE, "stroke-width": 1.4, opacity: 0 }, root),
          )
        : [];
      const pen = svgEl("circle", { cx: 0, cy: 0, r: 5, fill: ink, stroke: CASE_WHITE, "stroke-width": 1.8, opacity: 0 }, root);
      return { root, path, pen, verts, positions: geom.positions, closed: geom.closed };
    },
    render(p, n, ctx) {
      const points = n.positions.map((at) => ctx.project(at));
      if (!points.every((q): q is Pt => q !== null)) return hide(n.root);
      n.root.setAttribute("opacity", "1");
      const walk = walkPath(points, n.closed);
      const total = walk.total || 1;
      const drawn = inOutCubic(seg(p, 0, 0.68));
      n.path.setAttribute("d", pathD(points, n.closed));
      n.path.setAttribute("stroke-dasharray", `${total.toFixed(1)}`);
      n.path.setAttribute("stroke-dashoffset", (total * (1 - drawn)).toFixed(1));
      // The animated stroke fades as the shipped layer takes over: one shape,
      // one continuous act, no double outline left behind.
      setOpacity(n.path, 0.95 * (1 - seg(p, 0.78, 0.96)));
      const tip = pointAlong(walk, total * drawn);
      n.pen.setAttribute("cx", tip.x.toFixed(1));
      n.pen.setAttribute("cy", tip.y.toFixed(1));
      setOpacity(n.pen, 0.95 * seg(p, 0, 0.04) * (1 - seg(p, 0.68, 0.78)));
      n.verts.forEach((vert, k) => {
        vert.setAttribute("cx", points[k].x.toFixed(1));
        vert.setAttribute("cy", points[k].y.toFixed(1));
        const reach = walk.at[k] / total;
        setOpacity(vert, outCubic(seg(drawn, reach, reach + 0.08)) * (1 - seg(p, 0.78, 0.95)));
      });
    },
    rm(p, n, ctx) {
      const points = n.positions.map((at) => ctx.project(at));
      if (!points.every((q): q is Pt => q !== null)) return hide(n.root);
      n.root.setAttribute("opacity", "1");
      n.path.setAttribute("d", pathD(points, n.closed));
      n.path.removeAttribute("stroke-dasharray");
      setOpacity(n.path, 0.9 * bell(p));
      setOpacity(n.pen, 0);
      for (const vert of n.verts) setOpacity(vert, 0);
    },
    cleanup(n) {
      n.root.remove();
    },
  };
}

/**
 * annotate / human_note — "pin drop". The pin is the shipped DOM marker; the
 * driver writes its anchor, stem and card in, and one ripple marks the landing
 * on the map underneath. Every inline style it wrote is removed on cleanup, so
 * the pin goes back to being exactly the marker the store rendered.
 */
interface PinNodes extends FxNodes {
  root: SVGGElement;
  ripple: SVGCircleElement;
  parts: PinParts | null;
  at: LngLat;
}

function pinEffect(name: FxName, ink: string): Effect<PinNodes> {
  return {
    dur: 900,
    setup(ctx, geom) {
      if (geom.kind !== "pin" || !ctx.project(geom.at)) return null;
      const root = mapGroup(ctx, name);
      const ripple = svgEl("circle", { cx: 0, cy: 0, r: 4, fill: "none", stroke: ink, "stroke-width": 2.2, opacity: 0 }, root);
      return { root, ripple, parts: ctx.pin(geom.id), at: geom.at };
    },
    render(p, n, ctx) {
      const point = ctx.project(n.at);
      if (point) {
        n.root.setAttribute("opacity", "1");
        n.root.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
        const ripple = seg(p, 0.26, 0.62);
        n.ripple.setAttribute("r", lerp(4, 24, outCubic(ripple)).toFixed(1));
        setOpacity(n.ripple, 0.6 * bell(ripple));
      } else {
        hide(n.root);
      }
      const parts = n.parts;
      if (!parts) return;
      const drop = outCubic(seg(p, 0, 0.3));
      parts.anchor.style.opacity = fixed3(drop);
      parts.anchor.style.transform = `translateY(${(-26 * (1 - drop)).toFixed(1)}px)`;
      const stem = outCubic(seg(p, 0.3, 0.48));
      parts.stem.style.transformOrigin = "50% 100%";
      parts.stem.style.transform = `scaleY(${stem.toFixed(3)})`;
      const card = outCubic(seg(p, 0.45, 0.72));
      parts.card.style.opacity = fixed3(card);
      parts.card.style.transform = `translateY(${(7 * (1 - card)).toFixed(1)}px)`;
    },
    rm(p, n) {
      setOpacity(n.ripple, 0);
      const parts = n.parts;
      if (!parts) return;
      const op = fixed3(clamp01(p * 1.2));
      parts.anchor.style.opacity = op;
      parts.stem.style.opacity = op;
      parts.card.style.opacity = op;
    },
    cleanup(n) {
      n.root.remove();
      const parts = n.parts;
      if (!parts) return;
      for (const node of [parts.anchor, parts.stem, parts.card]) {
        node.style.opacity = "";
        node.style.transform = "";
        node.style.transformOrigin = "";
      }
    },
  };
}

/**
 * human_delete — "dissolve": materialise played backwards. A rose flash names
 * the artifact that is going, then a ghost of it fades and settles out. The
 * artifact itself has already left the store — this is the only effect whose
 * geometry outlives the thing it describes, and it lasts 700 ms.
 */
interface VanishNodes extends FxNodes {
  root: SVGGElement;
  ghost: SVGPathElement;
  flash: SVGPathElement;
  dot: SVGCircleElement | null;
  positions: LngLat[];
  closed: boolean;
}

const vanish: Effect<VanishNodes> = {
  dur: 700,
  setup(ctx, geom) {
    if (geom.kind !== "vanish" || geom.positions.length === 0) return null;
    if (geom.positions.some((at) => !ctx.project(at))) return null;
    const root = mapGroup(ctx, "human_delete");
    const ghost = svgEl(
      "path",
      { d: "", fill: ROSE_DEEP, "fill-opacity": 0.1, stroke: ROSE_DEEP, "stroke-width": 2.5, "stroke-linejoin": "round" },
      root,
    );
    const flash = svgEl("path", { d: "", fill: "none", stroke: ROSE, "stroke-width": 4, "stroke-linejoin": "round", opacity: 0 }, root);
    const dot =
      geom.positions.length === 1
        ? svgEl("circle", { cx: 0, cy: 0, r: 7, fill: ROSE_DEEP, opacity: 0.9 }, root)
        : null;
    return { root, ghost, flash, dot, positions: geom.positions, closed: geom.closed };
  },
  render(p, n, ctx) {
    const points = n.positions.map((at) => ctx.project(at));
    if (!points.every((q): q is Pt => q !== null)) return hide(n.root);
    const d = pathD(points, n.closed);
    n.ghost.setAttribute("d", d);
    n.flash.setAttribute("d", d);
    if (n.dot) {
      n.dot.setAttribute("cx", points[0].x.toFixed(1));
      n.dot.setAttribute("cy", points[0].y.toFixed(1));
    }
    setOpacity(n.flash, 0.9 * bell(seg(p, 0, 0.26)));
    const gone = inOutCubic(seg(p, 0.22, 0.9));
    setOpacity(n.root, 1 - gone);
    const cx = points.reduce((sum, q) => sum + q.x, 0) / points.length;
    const cy = points.reduce((sum, q) => sum + q.y, 0) / points.length;
    const scale = 1 - 0.1 * gone;
    n.root.setAttribute(
      "transform",
      `translate(${(cx * (1 - scale)).toFixed(2)} ${(cy * (1 - scale)).toFixed(2)}) scale(${scale.toFixed(4)})`,
    );
  },
  rm(p, n, ctx) {
    const points = n.positions.map((at) => ctx.project(at));
    if (!points.every((q): q is Pt => q !== null)) return hide(n.root);
    const d = pathD(points, n.closed);
    n.ghost.setAttribute("d", d);
    n.flash.setAttribute("d", d);
    if (n.dot) {
      n.dot.setAttribute("cx", points[0].x.toFixed(1));
      n.dot.setAttribute("cy", points[0].y.toFixed(1));
    }
    setOpacity(n.flash, 0);
    setOpacity(n.root, 1 - clamp01(p * 1.2));
  },
  cleanup(n) {
    n.root.remove();
  },
};

// ------------------------------------------------------------------ registry

const EFFECTS: Record<FxName, Effect> = {
  get_map_state: viewfinder as Effect,
  set_map_view: reticle as Effect,
  list_features_in_view: scanBand as Effect,
  find_features: findPulse as Effect,
  select_features: selectDropIn as Effect,
  draw_shape: inkEffect("draw_shape", TEAL_DEEP, false, 1500) as Effect,
  annotate: pinEffect("annotate", TEAL) as Effect,
  describe_surroundings: compass as Effect,
  compare_areas: twinPing as Effect,
  measure: ruler as Effect,
  get_share_link: packToChip as Effect,
  human_draw: inkEffect("human_draw", ROSE_DEEP, true, 1700) as Effect,
  human_note: pinEffect("human_note", ROSE_DEEP) as Effect,
  human_delete: vanish as Effect,
};

export function fxEffect(name: FxName): Effect | undefined {
  return EFFECTS[name];
}

/** Every effect name the registry answers to. Used by the ≤2 s law's own test. */
export const FX_EFFECT_NAMES = Object.keys(EFFECTS) as FxName[];

/** The declared durations, for the test that holds every one of them under 2 s. */
export const FX_DURATIONS: Record<FxName, number> = Object.fromEntries(
  FX_EFFECT_NAMES.map((name) => [name, EFFECTS[name].dur]),
) as Record<FxName, number>;
