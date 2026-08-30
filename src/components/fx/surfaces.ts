/**
 * The two surfaces every effect draws on, and the projection that keeps the
 * map-space one honest.
 *
 *  - `fx-viewport` — a pointer-events-none div over the map container, for the
 *    effects whose meaning IS the viewport (viewfinder, scan band, share pack).
 *    A camera move cannot invalidate them, so they never project.
 *  - `fx-overlay` — one SVG in map-container coordinates, for rings, ticks,
 *    dots, runners and pens. Every frame re-projects from lng/lat, which is
 *    strictly stronger than subscribing to `move`: an effect running through a
 *    `flyTo` tracks the ground, and a dropped frame is a skipped frame rather
 *    than a stale one. The shipped MapLibre layers stay the persistent
 *    artifacts — nothing here ever outlives its effect.
 */
import type { LngLat } from "@/lib/store/map-store";
import type { Pt } from "./geometry";
import { getFxMap } from "./map-handle";

export const SVG_NS = "http://www.w3.org/2000/svg";

/** The token ramps, verbatim from globals.css. FX introduces no new colour. */
export const TEAL = "#2dd4bf";
export const TEAL_DEEP = "#0b7285";
export const ROSE = "#f48fb1";
export const ROSE_DEEP = "#c2255c";
export const CASE_WHITE = "#ffffff";

type Attrs = Record<string, string | number>;

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent?.appendChild(node);
  return node;
}

export function divEl(className: string, parent?: Element): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  parent?.appendChild(node);
  return node;
}

/** One pin's animatable parts, as `annotation-marker.ts` builds them. */
export interface PinParts {
  root: HTMLElement;
  card: HTMLElement;
  stem: HTMLElement;
  anchor: HTMLElement;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FxContext {
  /** Viewport-space layer. Effects append a holder and remove it on cleanup. */
  viewport: HTMLElement;
  /** Map-space layer, in map-container pixels. */
  overlay: SVGSVGElement;
  /** Screen position of a place, or null when this page has no live map. */
  project(at: LngLat): Pt | null;
  /** A metre radius as screen pixels at that place, or null without a map. */
  radiusPx(at: LngLat, metres: number): number | null;
  size(): { width: number; height: number };
  /** Container width minus the inspector lane: the corridor a human can see. */
  corridorWidth(): number;
  /** The Share chip and its rect in container coordinates. */
  chip(): HTMLElement | null;
  chipRect(): Rect | null;
  /** The camera chip, whose box-shadow `get_map_state` glows. */
  cameraChip(): HTMLElement | null;
  /** An annotation's marker parts, or null if the marker is not on screen. */
  pin(id: string): PinParts | null;
}

/** One degree of longitude in metres at this latitude; the ring's scale bar. */
const metresPerDegreeLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/**
 * The inspector's lane, read from the same custom property the stylesheet lays
 * it out with — the same rule `MapCanvas.inspectorLane()` follows, so the FX
 * corridor and the camera's padding can never describe different rectangles.
 *
 * One clause of that rule is deliberately missing here: `inspectorLane()` also
 * answers 0 in human chrome, where no lane is mounted (T-82). Every effect
 * that consumes this — the viewfinder, the scan band, the pack-to-chip rect —
 * is a *tool* effect, and a tool call is exactly the write that puts the page
 * into agent chrome, so this is never read in a state where the two answers
 * differ. Human-gesture effects are drawn in map space and never ask.
 */
function laneWidth(): number {
  if (window.matchMedia("(max-width: 920px)").matches) return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--lane");
  return Number.parseFloat(value) || 0;
}

export function createFxContext(viewport: HTMLElement, overlay: SVGSVGElement): FxContext {
  const project = (at: LngLat): Pt | null => {
    const map = getFxMap();
    if (!map) return null;
    try {
      const point = map.project(at);
      return Number.isFinite(point.x) && Number.isFinite(point.y)
        ? { x: point.x, y: point.y }
        : null;
    } catch {
      // A map torn down mid-frame: no geometry rather than a thrown frame.
      return null;
    }
  };

  return {
    viewport,
    overlay,
    project,

    radiusPx: (at, metres) => {
      const scale = metresPerDegreeLng(at[1]);
      if (!Number.isFinite(scale) || scale <= 0) return null;
      const here = project(at);
      const east = project([at[0] + metres / scale, at[1]]);
      if (!here || !east) return null;
      return Math.hypot(east.x - here.x, east.y - here.y);
    },

    size: () => ({ width: viewport.clientWidth, height: viewport.clientHeight }),

    corridorWidth: () => Math.max(0, viewport.clientWidth - laneWidth()),

    chip: () => document.querySelector<HTMLElement>('[data-testid="share-chip"]'),

    chipRect: () => {
      const chip = document.querySelector<HTMLElement>('[data-testid="share-chip"]');
      if (!chip) return null;
      const c = chip.getBoundingClientRect();
      const v = viewport.getBoundingClientRect();
      return { left: c.left - v.left, top: c.top - v.top, width: c.width, height: c.height };
    },

    cameraChip: () => document.querySelector<HTMLElement>('[data-testid="camera-chip"]'),

    pin: (id) => {
      const root = document.querySelector<HTMLElement>(
        `[data-testid="annotation-pin"][data-annotation-id="${CSS.escape(id)}"]`,
      );
      if (!root) return null;
      const card = root.querySelector<HTMLElement>(".pin-card");
      const stem = root.querySelector<HTMLElement>(".pin-stem");
      const anchor = root.querySelector<HTMLElement>(".pin-anchor");
      return card && stem && anchor ? { root, card, stem, anchor } : null;
    },
  };
}
