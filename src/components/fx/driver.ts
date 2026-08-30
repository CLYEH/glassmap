/**
 * The FX spine: one shared rAF, a registry of pure `render(p)` effects, target-
 * keyed preemption, the reduced-motion switch and the kill switch.
 *
 * Four laws are enforced here rather than trusted to each effect:
 *
 *  1. **≤ 2 s.** `FX_MAX_MS` clamps every duration. An effect cannot outlive
 *     the calm map by declaring a longer one.
 *  2. **Zero residue.** Every path out of `play` — completion, preemption,
 *     kill switch, teardown — ends in the effect's own `cleanup`, exactly once.
 *  3. **Reduced motion** swaps in `rm(p)` at `RM_MS`, opacity-only.
 *  4. **Kill switch** (`body[data-fx="off"]`) short-circuits to
 *     `setup → render(1) → cleanup`: the final state, instantly, nothing moves.
 *
 * The driver is DOM-free on purpose — it moves numbers and calls back into
 * effects — so the timeline, the preemption and the four laws are unit tested
 * in node against fake effects.
 */
import { clamp01 } from "./easing";
import { keysClash, type FxGeom, type FxName, type FxPlan } from "./plan";

/** The calm map is law: nothing the agent does may hold the screen longer. */
export const FX_MAX_MS = 2000;

/** Reduced motion: one opacity crossfade, well inside the spec's 240 ms ceiling. */
export const RM_MS = 220;

/** How long a preempted effect gets to leave the screen. */
export const PREEMPT_FADE_MS = 120;

/** How long a degraded (geometry-less) call keeps its feed row lit. */
export const GLOW_ONLY_MS = 900;

/**
 * What an effect built. `root` is the one node the driver fades when the
 * effect is preempted; effects that write onto shipped DOM (the pin, the share
 * chip) point it at their own transient node.
 */
export interface FxNodes {
  root: SVGElement | HTMLElement | null;
}

/**
 * One effect. `setup` may answer null — "I have nothing honest to draw", e.g.
 * a map-space effect on a page whose map never started — and the driver then
 * degrades the call to its feed-row glow.
 */
export interface FxEffect<C, N extends FxNodes = FxNodes> {
  dur: number;
  setup(ctx: C, geom: FxGeom): N | null;
  render(p: number, nodes: N, ctx: C): void;
  /** Opacity-only variant for `prefers-reduced-motion`. */
  rm(p: number, nodes: N, ctx: C): void;
  cleanup(nodes: N, ctx: C): void;
}

/**
 * The degraded form every effect falls back to: the feed row glows on a real
 * clock, the map stays calm. This is the spec's degradation table as code —
 * a missing origin costs the map effect, never the synchrony that tells the
 * human which row is speaking.
 */
export function glowOnlyEffect<C>(): FxEffect<C> {
  return {
    dur: GLOW_ONLY_MS,
    setup: () => ({ root: null }),
    render: () => {},
    rm: () => {},
    cleanup: () => {},
  };
}

export interface FxHost<C> {
  now(): number;
  requestFrame(cb: (now: number) => void): number;
  cancelFrame(id: number): void;
  /** Re-read every play: e2e may flip the switch at any point in a session. */
  killed(): boolean;
  reduced(): boolean;
  /** Lights the entry's own feed row on the effect's clock. `p >= 1` clears it. */
  glow(seq: number, p: number): void;
  /** Called whenever the set of live effects changes, for the surface's testids. */
  onChange?(live: readonly LiveFx[]): void;
  effect(name: FxName): FxEffect<C> | undefined;
  context: C;
}

/** What a caller (and `data-fx-playing`) can see about a running effect. */
export interface LiveFx {
  id: number;
  name: FxName;
  keys: readonly string[];
  seq: number | null;
}

interface Handle<C> {
  id: number;
  plan: FxPlan;
  effect: FxEffect<C>;
  nodes: FxNodes;
  start: number;
  dur: number;
  reduced: boolean;
  /** A held still (`freeze`): the shared loop leaves it alone. */
  frozen: boolean;
  /** Set when preempted: the timestamp the 120 ms exit fade started at. */
  fadingSince: number | null;
}

export interface FxDriver {
  /** Plays a plan. Returns the live id, or null when nothing was played at all. */
  play(plan: FxPlan): number | null;
  /** Renders one effect at a fixed progress and holds it there — for stills. */
  freeze(plan: FxPlan, p: number): number | null;
  live(): LiveFx[];
  /** Ends everything now, cleanly. Used on unmount. */
  stopAll(): void;
}

export function createFxDriver<C>(host: FxHost<C>): FxDriver {
  const handles = new Map<number, Handle<C>>();
  const fallback = glowOnlyEffect<C>();
  let nextId = 1;
  let frame: number | null = null;

  const live = (): LiveFx[] =>
    [...handles.values()]
      .filter((h) => h.fadingSince === null)
      .map((h) => ({ id: h.id, name: h.plan.name, keys: h.plan.keys, seq: h.plan.seq }));

  const announce = () => host.onChange?.(live());

  /** Law 2 made structural: the first caller wins, so cleanup runs exactly once. */
  const finish = (h: Handle<C>) => {
    if (!handles.delete(h.id)) return;
    if (h.plan.seq !== null) host.glow(h.plan.seq, 1);
    h.effect.cleanup(h.nodes, host.context);
  };

  const step = (now: number) => {
    frame = null;
    let ended = false;
    for (const h of [...handles.values()]) {
      try {
        if (h.frozen && h.fadingSince === null) continue;
        if (h.fadingSince !== null) {
          const q = clamp01((now - h.fadingSince) / PREEMPT_FADE_MS);
          const root = h.nodes.root;
          if (root) root.style.opacity = (1 - q).toFixed(3);
          if (q >= 1) {
            finish(h);
            ended = true;
          }
          continue;
        }
        const p = clamp01((now - h.start) / h.dur);
        const render = h.reduced ? h.effect.rm : h.effect.render;
        render.call(h.effect, p, h.nodes, host.context);
        if (h.plan.seq !== null) host.glow(h.plan.seq, p);
        if (p >= 1) {
          finish(h);
          ended = true;
        }
      } catch {
        // One effect must not take the frame down with it: the survivors would
        // stop mid-animation with their DOM stranded on the map. A thrower
        // leaves the way every other path leaves — through `finish`, once.
        finish(h);
        ended = true;
      }
    }
    // Announced on every step where something ended, survivors or not: while a
    // long effect keeps the loop alive, `data-fx-playing` would otherwise still
    // name the effect that finished several hundred milliseconds ago.
    if (ended) announce();
    const running = [...handles.values()].some((h) => !h.frozen || h.fadingSince !== null);
    if (running) frame = host.requestFrame(step);
  };

  const schedule = () => {
    if (frame === null) frame = host.requestFrame(step);
  };

  /**
   * Concurrency rules 1–4: a new effect fast-fades every running effect whose
   * TARGET set it intersects, and coexists with the rest. There is no queue —
   * the feed is the queue. Note that identity, not name, decides: two
   * `draw_shape` calls on different shapes are independent and overlap freely,
   * while a describe and a compare about the same place replace each other.
   */
  const preempt = (plan: FxPlan, now: number) => {
    for (const h of handles.values()) {
      if (h.fadingSince !== null) continue;
      if (!keysClash(plan.keys, h.plan.keys)) continue;
      h.fadingSince = now;
      // The row stops glowing the moment its effect stops telling the story.
      if (h.plan.seq !== null) host.glow(h.plan.seq, 1);
    }
  };

  const build = (plan: FxPlan): { effect: FxEffect<C>; nodes: FxNodes } => {
    const declared = plan.geom.kind === "none" ? undefined : host.effect(plan.name);
    if (declared) {
      let nodes: FxNodes | null = null;
      try {
        nodes = declared.setup(host.context, plan.geom);
      } catch {
        // An effect that cannot build itself must never take the page with it:
        // the map is the product, FX is the commentary.
        nodes = null;
      }
      if (nodes) return { effect: declared, nodes };
    }
    return { effect: fallback, nodes: { root: null } };
  };

  const start = (plan: FxPlan, frozen: boolean, at: number): Handle<C> => {
    const { effect, nodes } = build(plan);
    const reduced = host.reduced();
    const dur = Math.min(FX_MAX_MS, reduced ? RM_MS : effect.dur);
    const h: Handle<C> = {
      id: nextId++,
      plan,
      effect,
      nodes,
      start: at,
      dur,
      reduced,
      frozen,
      fadingSince: null,
    };
    handles.set(h.id, h);
    return h;
  };

  return {
    play(plan) {
      if (host.killed()) {
        const { effect, nodes } = build(plan);
        effect.render(1, nodes, host.context);
        effect.cleanup(nodes, host.context);
        return null;
      }
      const now = host.now();
      preempt(plan, now);
      const h = start(plan, false, now);
      announce();
      schedule();
      return h.id;
    },

    freeze(plan, p) {
      const now = host.now();
      preempt(plan, now);
      const h = start(plan, true, now);
      const render = h.reduced ? h.effect.rm : h.effect.render;
      render.call(h.effect, clamp01(p), h.nodes, host.context);
      if (plan.seq !== null) host.glow(plan.seq, clamp01(p));
      announce();
      // Preempted neighbours still have 120 ms of exit fade to render.
      schedule();
      return h.id;
    },

    live,

    stopAll() {
      if (frame !== null) host.cancelFrame(frame);
      frame = null;
      for (const h of [...handles.values()]) finish(h);
      announce();
    },
  };
}
