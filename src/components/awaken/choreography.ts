"use client";

import { AWAKEN_MS, AWAKEN_RM_MS } from "@/lib/awaken";
import {
  DESKTOP_BEATS,
  MOBILE_BEATS,
  flash,
  phase,
  typedChars,
  type AwakenTier,
} from "@/lib/awaken/timeline";

/**
 * The awakening, painted.
 *
 * `lib/awaken/` decides *when* the page crosses from human chrome to agent
 * chrome; `lib/awaken/timeline.ts` says *where every beat sits* on the clock.
 * This is the third part — *what moves* — and it is deliberately the only one
 * of the three that knows the DOM exists.
 *
 * Imperative, like `components/fx/`, and for the same reason: this runs inside
 * `requestAnimationFrame`, and a React state write per frame would re-render
 * the page sixty times a second for 1.8 s. React mounts the agent chrome (one
 * commit, when the mode becomes "waking") and then this drives it frame by
 * frame; at the end it clears every inline style it wrote and hands the chrome
 * back to the stylesheet.
 *
 * ## The no-jump contract
 *
 * The point of the transition is that the chrome *travels* to where the agent
 * stylesheet puts it. So every displacement here is computed as the delta
 * between the human rule and the agent rule (`globals.css`), and at p=1 it
 * equals that delta exactly — `land()` then removes the transform and sets
 * `html[data-chrome="awake"]`, and nothing moves at the handover. The deltas:
 *
 *  - tools / draw hint / note popover: `right: 14px` → `calc(--lane + 22px)`,
 *    so −(lane + 8).
 *  - the bottom bar's corner: `right: 14px` → `calc(--lane + 14px)`, so −lane.
 *  - the Places dock: `left: 50%` (with a −50% of its own width) →
 *    `left: calc((100% − --lane − 10px) / 2)`, so −(lane + 10)/2.
 *  - mobile: the whole bottom band rides up by the sheet's height, from the
 *    foot of the screen to the map container's own bottom edge. Down here the
 *    container has *already* given up the sheet's band — `.map-wrap { bottom:
 *    46vh }` applies from the first frame of `waking`, because that container
 *    is what MapLibre measures and a resize in the landing frame would
 *    translate the whole map 194px. So the band is `position: fixed` for the
 *    length of the story (globals.css), which puts p=0 back at the human rule
 *    and p=1 exactly on the agent one.
 *
 * ## What it does not touch
 *
 * The map. `MapCanvas` pads its camera into the corridor the lane leaves and
 * publishes that rectangle as `bounds`, and it reads the *store* to decide —
 * so an agent that calls `get_map_state()` during the 1.8 s gets the corridor
 * it is about to have, not one that lags the animation. A tool's answer must
 * not depend on a frame number.
 */

/** The caption's dwell as a toast once the story lands (owner sign-off, §8.4 item 3). */
const TOAST_DWELL_MS = 3200;

/**
 * What the toast says, in one place because two surfaces say it: the visible
 * caption `AwakenStage` renders, and the live region this module writes it into
 * when the toast is raised. They must not be able to drift.
 */
export const AWAKEN_CAPTION = "An agent joined this map";

/** The caption's resting transform — its own centring, and nothing else. */
const CAPTION_REST = "translateX(-50%)";

/** Below this the page has no lane and no floating feed: the 390px story runs. */
const SHEET_QUERY = "(max-width: 920px)";

/** The dock loses its own centring transform on the phone tier (globals.css). */
const PHONE_QUERY = "(max-width: 640px)";

/** The light the choreography paints with, rendered once by `AwakenStage`. */
export interface AwakenStageNodes {
  stage: HTMLElement;
  flare: HTMLElement;
  ripple: HTMLElement;
  bloom: HTMLElement;
  sheen: HTMLElement;
  laneEdge: HTMLElement;
  caption: HTMLElement;
  /**
   * The toast's live region: always present, never `inert`, and **empty until
   * the toast is raised**. A live region only announces a mutation of its own
   * contents, so it has to exist — and be in the accessibility tree — before
   * the sentence arrives. The visible caption cannot be that region: it is
   * `inert` while hidden (so Tab can never reach a control nobody can see),
   * and inert content is not in the tree at all, so a screen reader would
   * never hear this transition happen.
   */
  announce: HTMLElement;
}

export interface AwakenPlayOptions {
  nodes: AwakenStageNodes;
  /** Called once when the story lands — the controller's `completeWaking()`. */
  onLand(): void;
  /**
   * Puts the chrome in its final *positions* without ending the transition.
   * Only the reduced-motion path uses it: there is no travel to animate there,
   * so the stylesheet places everything and opacity does the whole crossing.
   */
  finalPositions(): void;
  /** Hold this frame instead of playing (the dev/QA freeze). */
  freezeAt?: number | null;
}

export interface AwakenPlayer {
  /**
   * Tear everything down: the clock, the skip listeners, the toast and its own
   * dwell and Esc listener, and the DOM lands in the awake state. Safe to call
   * twice. This is the unmount path — a toast nobody is left to dismiss must
   * not outlive the module that put it there.
   */
  cancel(): void;
  /**
   * Let go without touching the toast. The one caller is the React cleanup
   * that fires *because* the story finished: the mode changed to "awake", the
   * effect that owns the player re-runs, and the toast it just raised has to
   * survive that. (§4: natural completion disarms the skip listener only; the
   * toast's Esc listener and dwell timer are correctly live while it shows.)
   */
  detach(): void;
  /** Whether the story has already reached its end state. */
  landed(): boolean;
}

/** Every inline property this module wrote, so it can put all of them back. */
type Ink = Map<HTMLElement, Set<string>>;

function write(ink: Ink, node: HTMLElement | null, styles: Record<string, string>): void {
  if (!node) return;
  let props = ink.get(node);
  if (!props) ink.set(node, (props = new Set()));
  for (const [prop, value] of Object.entries(styles)) {
    props.add(prop);
    node.style.setProperty(prop, value);
  }
}

function erase(ink: Ink): void {
  for (const [node, props] of ink) for (const prop of props) node.style.removeProperty(prop);
  ink.clear();
}

const pick = <T extends HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

/** The chrome the story moves, looked up once per play. */
interface Cast {
  tier: AwakenTier;
  phone: boolean;
  vw: number;
  vh: number;
  /** The spark's centre: where the flare ignites and the ripple comes from. */
  sparkX: number;
  sparkY: number;
  lane: number;
  laneTravel: number;
  sheet: number;
  sparkWrap: HTMLElement | null;
  badge: HTMLElement | null;
  hint: HTMLElement | null;
  tools: HTMLElement | null;
  drawHint: HTMLElement | null;
  notePop: HTMLElement | null;
  corner: HTMLElement | null;
  dock: HTMLElement | null;
  bottomBar: HTMLElement | null;
  camChip: HTMLElement | null;
  feed: HTMLElement | null;
  /**
   * Where the feed will be, measured once. Not per frame: the slab's own
   * transform moves its rectangle, so a live read would drag the bloom around
   * behind it — and a layout read between style writes costs a reflow a frame.
   */
  feedBox: DOMRect | null;
  feedCount: HTMLElement | null;
  laneEl: HTMLElement | null;
  laneHead: HTMLElement | null;
  laneBody: HTMLElement | null;
  firstRow: HTMLElement | null;
  waitRow: HTMLElement | null;
  ticker: HTMLElement | null;
  tickerSum: HTMLElement | null;
  tickerCount: HTMLElement | null;
  /** The summary the ticker is typing, captured before the first character. */
  typing: string;
}

function readCast(): Cast {
  const tier: AwakenTier = window.matchMedia(SHEET_QUERY).matches ? "mobile" : "desktop";
  const spark = pick('[data-testid="agent-spark"]');
  const laneEl = pick('[data-testid="sidebar"]');
  const feed = pick('[data-testid="activity-feed"]');
  const ticker = pick('[data-testid="activity-ticker"]');
  const tickerSum = ticker?.querySelector<HTMLElement>(".ticker-sum") ?? null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // The spark is the story's origin. If it is somehow not on the page, the
  // light still has to come from *somewhere* honest: the corner it lives in.
  const sparkBox = spark?.getBoundingClientRect();
  const laneBox = laneEl?.getBoundingClientRect();
  return {
    tier,
    phone: window.matchMedia(PHONE_QUERY).matches,
    vw,
    vh,
    sparkX: sparkBox ? sparkBox.left + sparkBox.width / 2 : vw - 30,
    sparkY: sparkBox ? sparkBox.top + sparkBox.height / 2 : vh - 30,
    lane: tier === "mobile" ? 0 : (laneBox?.width ?? 0),
    laneTravel: (laneBox?.width ?? 0) + 20,
    sheet: tier === "mobile" ? (laneBox?.height ?? 0) : 0,
    sparkWrap: pick(".spark-wrap"),
    badge: pick('[data-testid="webmcp-status"]'),
    hint: pick('[data-testid="map-hint"]'),
    tools: pick('[data-testid="tools"]'),
    drawHint: pick(".draw-hint"),
    notePop: pick(".note-pop"),
    corner: pick(".corner"),
    dock: pick('[data-testid="places-dock"]'),
    bottomBar: pick(".bottom-bar"),
    camChip: pick('[data-testid="camera-chip"]'),
    feed,
    feedBox: feed?.getBoundingClientRect() ?? null,
    feedCount: feed?.querySelector<HTMLElement>(".feed-count") ?? null,
    laneEl,
    laneHead: laneEl?.querySelector<HTMLElement>(".insp-head") ?? null,
    laneBody: laneEl?.querySelector<HTMLElement>(".insp-body") ?? null,
    firstRow: pick('[data-testid="activity-call"]'),
    waitRow: pick(".feed-list .call.wait"),
    ticker,
    tickerSum,
    tickerCount: ticker?.querySelector<HTMLElement>(".ticker-n") ?? null,
    typing: tickerSum?.textContent ?? "",
  };
}

/**
 * Plays the transition, or holds one frame of it.
 *
 * Three paths reach the same end state, which is the whole point of having
 * them: the kill switch (`body[data-fx="off"]`) jumps there with no motion at
 * all, reduced motion crosses in one 220 ms opacity fade, and everybody else
 * gets the 1800 ms story. A still is the story's own `render(p)` held at a
 * frame, never a fourth code path — a screenshot that could disagree with the
 * animation would be worthless as a reference.
 */
export function playAwakening({
  nodes,
  onLand,
  finalPositions,
  freezeAt,
}: AwakenPlayOptions): AwakenPlayer {
  const ink: Ink = new Map();
  const cast = readCast();
  const killed = document.body.dataset.fx === "off";
  const reduced =
    new URLSearchParams(window.location.search).get("rm") === "1" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let frame: number | null = null;
  let dwell: ReturnType<typeof setTimeout> | null = null;
  let onEscape: ((event: KeyboardEvent) => void) | null = null;
  let onSkip: (() => void) | null = null;
  let landed = false;

  nodes.stage.dataset.awakenTier = cast.tier;

  /* ------------------------------------------------------------------ light */

  const paintLight = (p: number) => {
    const beats = cast.tier === "mobile" ? MOBILE_BEATS : DESKTOP_BEATS;
    const ph = phase(p, cast.tier);
    const burst = flash(p, beats.flare);
    write(ink, nodes.flare, {
      left: `${cast.sparkX}px`,
      top: `${cast.sparkY}px`,
      opacity: burst.toFixed(3),
      transform: `translate(-50%,-50%) scale(${(0.55 + 1.05 * ph.flare).toFixed(3)})`,
    });
    // The lens-wave: a ring that leaves the spark and crosses the whole glass.
    // Sized off the viewport diagonal so it clears the corner it started in.
    const reach = Math.hypot(cast.vw, cast.vh) * 1.25 * ph.ripple;
    write(ink, nodes.ripple, {
      left: `${cast.sparkX}px`,
      top: `${cast.sparkY}px`,
      width: `${reach.toFixed(1)}px`,
      height: `${reach.toFixed(1)}px`,
      opacity: (0.9 * Math.pow(Math.sin(Math.PI * Math.min(1, ph.ripple)), 0.7)).toFixed(3),
    });
    write(ink, cast.sparkWrap, { transform: `scale(${(1 + 0.55 * burst).toFixed(3)})` });
    write(ink, cast.hint, { opacity: (1 - ph.hint).toFixed(3) });
  };

  /* ----------------------------------------------------------------- desktop */

  const paintDesktop = (p: number) => {
    const ph = phase(p, "desktop");

    // The feed condenses out of light: the bloom gathers where the panel will
    // be (plus-lighter, so it emits rather than greying the tint), the slab
    // resolves inside it, and both are gone by the time the story lands.
    if (cast.feedBox) {
      const box = cast.feedBox;
      write(ink, nodes.bloom, {
        left: `${box.left - 26}px`,
        top: `${box.top - 26}px`,
        width: `${box.width + 52}px`,
        height: `${Math.max(box.height, 120) + 52}px`,
        opacity: (0.95 * Math.pow(Math.sin(Math.PI * ph.bloom), 0.8)).toFixed(3),
        transform: `scale(${(0.82 + 0.24 * ph.bloom).toFixed(3)})`,
      });
      write(ink, nodes.sheen, {
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        opacity: ph.sheen > 0 && ph.sheen < 1 ? "1" : "0",
      });
      const bar = nodes.sheen.firstElementChild as HTMLElement | null;
      write(ink, bar, {
        transform: `translateX(${(-160 + 480 * ph.sheen).toFixed(1)}%) skewX(-14deg)`,
      });
    }
    write(ink, cast.feed, {
      opacity: ph.slab.toFixed(3),
      transform: `translateY(${(10 * (1 - ph.slab)).toFixed(2)}px) scale(${(0.965 + 0.035 * ph.slab).toFixed(3)})`,
    });

    // The pane arrives from the east with its leading edge lit, and the chrome
    // it displaces travels with it — in sync, by construction (see the header).
    write(ink, cast.laneEl, {
      opacity: Math.min(1, ph.lane * 2.2).toFixed(3),
      transform: `translateX(${(cast.laneTravel * (1 - ph.lane)).toFixed(2)}px)`,
    });
    write(ink, nodes.laneEdge, {
      right: `${cast.lane}px`,
      opacity: Math.pow(Math.sin(Math.PI * Math.min(1, ph.lane * 1.12)), 0.8).toFixed(3),
      transform: `translateX(${(cast.laneTravel * (1 - ph.lane)).toFixed(2)}px)`,
    });
    // The pane's words condense after its edge has passed (r3 finding 7a).
    write(ink, cast.laneHead, { opacity: ph.laneText.toFixed(3) });
    write(ink, cast.laneBody, { opacity: ph.laneText.toFixed(3) });

    const toolsDx = -(cast.lane + 8) * ph.lane;
    write(ink, cast.tools, { transform: `translateX(${toolsDx.toFixed(2)}px)` });
    write(ink, cast.drawHint, { transform: `translateX(${toolsDx.toFixed(2)}px)` });
    write(ink, cast.notePop, { transform: `translateX(${toolsDx.toFixed(2)}px)` });
    write(ink, cast.corner, { transform: `translateX(${(-cast.lane * ph.lane).toFixed(2)}px)` });
    write(ink, cast.dock, {
      transform: `translateX(calc(-50% + ${(-((cast.lane + 10) / 2) * ph.lane).toFixed(2)}px))`,
    });

    // The spark hands over to the badge, in the corner they share.
    write(ink, cast.sparkWrap, {
      opacity: (1 - ph.badge).toFixed(3),
      visibility: ph.badge >= 1 ? "hidden" : "visible",
    });
    if (ph.badge > 0) {
      write(ink, cast.sparkWrap, {
        transform: `scale(${(1 - 0.3 * ph.badge).toFixed(3)})`,
      });
    }
    write(ink, cast.badge, {
      opacity: ph.badge.toFixed(3),
      transform: `scale(${(0.85 + 0.15 * ph.badge).toFixed(3)})`,
    });

    // The first call writes itself; the Listening row rides the slab's
    // hardening so a hard panel is never empty and mute (r4 finding 5).
    write(ink, cast.firstRow, {
      opacity: ph.row.toFixed(3),
      "clip-path": `inset(0 ${(100 - 100 * ph.row).toFixed(2)}% 0 0)`,
    });
    write(ink, cast.waitRow, { opacity: ph.listen.toFixed(3) });
    write(ink, cast.camChip, { opacity: ph.row.toFixed(3) });
    // The count is the call's, so it may not precede the call's own row. Hidden
    // rather than blanked: the text belongs to React, and a string written over
    // it here would survive as a stale count if a second call landed mid-story.
    write(ink, cast.feedCount, { opacity: ph.row >= 1 ? "1" : "0" });
  };

  /* ------------------------------------------------------------------ mobile */

  const paintMobile = (p: number) => {
    const ph = phase(p, "mobile");

    write(ink, cast.ticker, {
      opacity: Math.min(1, ph.ticker * 2.8).toFixed(3),
      transform: `translateY(${(-10 * (1 - Math.min(1, ph.ticker * 2))).toFixed(2)}px)`,
    });
    if (cast.tickerSum) {
      const chars = typedChars(cast.typing.length, ph.type);
      const cursor = chars > 0 && chars < cast.typing.length ? "▏" : "";
      cast.tickerSum.textContent = cast.typing.slice(0, chars) + cursor;
    }
    write(ink, cast.tickerCount, { opacity: ph.type >= 1 ? "1" : "0" });

    // The sheet rises, and the bottom band rides its top edge: legend,
    // attribution, badge and dock start at the foot of the screen (the band is
    // `fixed` while the story runs) and end exactly where the awake rule puts
    // them — `bottom: 12px` inside a container that is already 46vh short.
    write(ink, cast.laneEl, {
      // Opaque from the first frame, unlike the desktop pane: this one rises
      // from under the screen, so it has nothing to fade in over — and the
      // `waking` stylesheet holds every agent surface at opacity 0 until its
      // own beat says otherwise.
      opacity: "1",
      transform: `translateY(${((1 - ph.sheet) * (cast.sheet + 24)).toFixed(2)}px)`,
    });
    const ride = (-cast.sheet * ph.sheet).toFixed(2);
    write(ink, cast.bottomBar, { transform: `translateY(${ride}px)` });
    write(ink, cast.dock, {
      // The dock carries its own centring transform above the phone tier.
      transform: cast.phone
        ? `translateY(${ride}px)`
        : `translateX(-50%) translateY(${ride}px)`,
    });

    write(ink, cast.sparkWrap, {
      opacity: (1 - ph.spark).toFixed(3),
      visibility: ph.spark >= 1 ? "hidden" : "visible",
    });
    write(ink, cast.badge, { opacity: ph.badge.toFixed(3) });
  };

  /* ----------------------------------------------------------------- caption */

  /**
   * The caption's own beat. `rise` is the 6px it blooms up through — the
   * reduced-motion path passes `false` and gets the resting transform instead,
   * because "one 220 ms opacity crossfade" has to mean opacity and nothing
   * else: a caption that travelled 6.34px while everything around it held
   * still would be the one thing on the page still moving.
   */
  const paintCaption = (value: number, rise = true) => {
    write(ink, nodes.caption, {
      opacity: (value * 0.97).toFixed(3),
      transform: rise
        ? `${CAPTION_REST} translateY(${(6 * (1 - value)).toFixed(2)}px)`
        : CAPTION_REST,
      "pointer-events": value > 0 ? "auto" : "none",
    });
    nodes.caption.inert = value <= 0;
    nodes.caption.dataset.shown = value > 0 ? "true" : "false";
  };

  const render = (p: number) => {
    nodes.stage.dataset.awakenP = p.toFixed(3);
    paintLight(p);
    if (cast.tier === "mobile") paintMobile(p);
    else paintDesktop(p);
    paintCaption(phase(p, cast.tier).caption);
  };

  /**
   * Reduced motion: the chrome is already where it belongs (the stylesheet put
   * it there the moment the mode changed) and only opacity travels. Note for
   * anyone reading a dump mid-crossfade: `data-chrome` is "waking" while the
   * elements sit at their final positions, which is correct rather than a bug.
   */
  const renderReduced = (p: number) => {
    nodes.stage.dataset.awakenP = p.toFixed(3);
    finalPositions();
    const fading = [cast.feed, cast.laneEl, cast.badge, cast.camChip, cast.ticker];
    for (const node of fading) write(ink, node, { opacity: p.toFixed(3) });
    write(ink, cast.sparkWrap, { opacity: (1 - p).toFixed(3) });
    write(ink, cast.hint, { opacity: (1 - p).toFixed(3) });
    // Still: the resting transform, not the 6px bloom (see `paintCaption`).
    paintCaption(p, false);
  };

  /* -------------------------------------------------------------- the toast */

  const dismissToast = () => {
    if (dwell !== null) {
      clearTimeout(dwell);
      dwell = null;
    }
    if (onEscape) {
      window.removeEventListener("keydown", onEscape);
      onEscape = null;
    }
    nodes.caption.style.transition = "opacity .35s";
    nodes.caption.style.opacity = "0";
    nodes.caption.style.pointerEvents = "none";
    nodes.caption.inert = true;
    nodes.caption.dataset.shown = "false";
    // Emptied, so the region is back where it started and a replay announces
    // again. A polite region says nothing about a removal, so this is silent.
    nodes.announce.textContent = "";
  };

  const showToast = () => {
    // The announcement, at the moment there is something to announce. The
    // region has been on the page and in the accessibility tree since mount
    // with nothing in it; this write is the mutation a screen reader hears.
    nodes.announce.textContent = AWAKEN_CAPTION;
    nodes.caption.style.opacity = "0.97";
    nodes.caption.style.pointerEvents = "auto";
    nodes.caption.inert = false;
    nodes.caption.dataset.shown = "true";
    onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissToast();
    };
    window.addEventListener("keydown", onEscape);
    dwell = setTimeout(() => {
      dwell = null;
      dismissToast();
    }, TOAST_DWELL_MS);
  };

  nodes.caption.addEventListener("click", dismissToast);

  /* ------------------------------------------------------------ the clock */

  const disarmSkip = () => {
    if (!onSkip) return;
    window.removeEventListener("keydown", onSkip);
    onSkip = null;
  };

  /**
   * The end: every inline style removed, the mode handed to the stylesheet,
   * and the caption promoted to a toast on its own clock. Idempotent — the
   * skip, the ceiling, a teardown and the last frame can all arrive here.
   */
  const land = (withToast: boolean) => {
    if (landed) return;
    landed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    disarmSkip();
    // The ticker's text is the one thing the story rewrote rather than
    // restyled; React's virtual DOM still believes its own string, so it would
    // never repair a half-typed summary on its own.
    if (cast.tickerSum) cast.tickerSum.textContent = cast.typing;
    erase(ink);
    nodes.stage.dataset.awakenP = "1";
    for (const node of [nodes.flare, nodes.ripple, nodes.bloom, nodes.sheen, nodes.laneEdge]) {
      node.style.opacity = "0";
    }
    onLand();
    if (withToast) showToast();
    else paintCaption(0);
  };

  /** Every exit that is not the story's own ending. */
  const player: AwakenPlayer = {
    landed: () => landed,
    detach: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      disarmSkip();
    },
    cancel: () => {
      nodes.caption.removeEventListener("click", dismissToast);
      delete nodes.stage.dataset.awakenFrozen;
      dismissToast();
      land(false);
    },
  };

  if (freezeAt !== null && freezeAt !== undefined) {
    // A still is the story's own render held at a frame, never a fourth code
    // path: a screenshot that could disagree with the animation is not a
    // reference. The marker is the harness's, exactly as the mockup has it.
    nodes.stage.dataset.awakenFrozen = "1";
    const held = Math.min(1, Math.max(0, freezeAt));
    if (killed) render(1);
    else if (reduced) renderReduced(held);
    else render(held);
    return player;
  }

  delete nodes.stage.dataset.awakenFrozen;

  // Kill switch: the end state, instantly, nothing moves. The same law the FX
  // driver holds — a page with `data-fx="off"` is byte-identical to a calm one.
  //
  // `land(false)` also withholds the toast, and that is about screenshots
  // rather than about bytes: the toast dismisses itself 3.2 s after it appears,
  // so a page photographed with the transition off would show it or not
  // depending on when the shutter fell. Reduced motion, which has no such
  // clock to race, keeps the toast — the crossfade removes the motion, and the
  // sentence is information.
  if (killed) {
    land(false);
    return player;
  }

  const started = performance.now();
  const duration = reduced ? AWAKEN_RM_MS : AWAKEN_MS;
  const step = (now: number) => {
    // Clamped at both ends. The ceiling is the story's; the floor is real too —
    // `performance.now()` inside the first callback can precede the reading
    // taken just before `requestAnimationFrame` registered it, and a negative
    // `p` is an opacity of "-0.018" on the reduced-motion path (which uses it
    // raw) and a nonsense freeze marker on both.
    const p = Math.min(1, Math.max(0, (now - started) / duration));
    if (reduced) renderReduced(p);
    else render(p);
    if (p < 1) frame = requestAnimationFrame(step);
    else land(true);
  };
  frame = requestAnimationFrame(step);

  // A person who has seen it once should not have to sit through it again: any
  // key lands the end state immediately. Armed only for the story itself, and
  // dropped by every exit there is (`land`, `detach`, `cancel`).
  //
  // **Keys only — not pointers**, which is a deliberate departure from the
  // design's "click/key skips it". A pointer press has a *place*, and skipping
  // on `pointerdown` moves the chrome out from under the finger that is
  // pressing it: mousedown lands on the Note pill, the story jumps to its end,
  // the pill travels 344 px left with the lane, and mouseup lands on the map —
  // so the browser fires no click on the button at all and the press is
  // swallowed. Reproduced against a real click in
  // `e2e/redesign-share-provenance.spec.ts`. A keystroke has no place, so it
  // cannot do that.
  if (!reduced) {
    onSkip = () => land(true);
    window.addEventListener("keydown", onSkip);
  }

  return player;
}
