import { describe, expect, it } from "vitest";
import {
  FX_MAX_MS,
  GLOW_ONLY_MS,
  PREEMPT_FADE_MS,
  RM_MS,
  createFxDriver,
  type FxEffect,
  type FxHost,
  type FxNodes,
  type LiveFx,
} from "./driver";
import type { FxGeom, FxName, FxPlan } from "./plan";

interface Ctx {
  log: string[];
}

interface Recorded extends FxNodes {
  frames: number[];
}

function fakeEffect(name: string, dur: number, log: string[]): FxEffect<Ctx, Recorded> {
  return {
    dur,
    setup: () => {
      log.push(`setup:${name}`);
      return { root: null, frames: [] };
    },
    render: (p, nodes) => {
      nodes.frames.push(p);
      log.push(`render:${name}:${p.toFixed(2)}`);
    },
    rm: (p, nodes) => {
      nodes.frames.push(p);
      log.push(`rm:${name}:${p.toFixed(2)}`);
    },
    cleanup: () => log.push(`cleanup:${name}`),
  };
}

/** An effect whose every frame throws — the "one bad effect on the page" case. */
function explodingEffect(log: string[]): FxEffect<Ctx, Recorded> {
  const base = fakeEffect("boom", 1000, log);
  return {
    ...base,
    render: (p, nodes, ctx) => {
      base.render(p, nodes, ctx);
      throw new Error("render exploded");
    },
  };
}

function harness(options: { killed?: boolean; reduced?: boolean } = {}) {
  const log: string[] = [];
  const glows: [number, number][] = [];
  const changes: LiveFx[][] = [];
  const queue: ((now: number) => void)[] = [];
  const effects = new Map<string, FxEffect<Ctx>>([
    ["get_map_state", fakeEffect("get_map_state", 1100, log) as FxEffect<Ctx>],
    ["set_map_view", fakeEffect("set_map_view", 1300, log) as FxEffect<Ctx>],
    ["draw_shape", fakeEffect("draw_shape", 9000, log) as FxEffect<Ctx>],
    ["boom", explodingEffect(log) as FxEffect<Ctx>],
  ]);
  let clock = 1000;
  const host: FxHost<Ctx> = {
    now: () => clock,
    requestFrame: (cb) => queue.push(cb),
    cancelFrame: () => {},
    killed: () => options.killed === true,
    reduced: () => options.reduced === true,
    glow: (seq, p) => glows.push([seq, p]),
    onChange: (live) => changes.push([...live]),
    effect: (name) => effects.get(name),
    context: { log },
  };
  const driver = createFxDriver(host);
  /** Runs every frame the driver has asked for, at `to` milliseconds. */
  const tick = (to: number) => {
    clock = to;
    const pending = queue.splice(0, queue.length);
    for (const cb of pending) cb(to);
  };
  return { driver, log, glows, changes, tick, queue };
}

const plan = (
  name: string,
  keys: string[],
  seq: number | null = 1,
  geom: FxGeom = { kind: "viewport" },
): FxPlan => ({ name: name as FxName, keys, geom, seq });

describe("the shared timeline", () => {
  it("drives every live effect from one frame callback", () => {
    // One rAF for the whole page is the difference between "the agent's hand"
    // and seventeen independent animation loops fighting the compositor.
    const { driver, tick, queue } = harness();
    driver.play(plan("get_map_state", ["viewport"]));
    driver.play(plan("set_map_view", ["camera"], 2));
    expect(queue.length).toBe(1);
    tick(1100);
    expect(driver.live().map((fx) => fx.name).sort()).toEqual(["get_map_state", "set_map_view"]);
    expect(queue.length).toBe(1);
  });

  it("renders p as elapsed/duration and finishes at exactly 1", () => {
    const { driver, log, tick } = harness();
    driver.play(plan("get_map_state", ["viewport"]));
    tick(1550); // half of 1100 ms
    expect(log).toContain("render:get_map_state:0.50");
    tick(2100);
    expect(log).toContain("render:get_map_state:1.00");
    expect(log).toContain("cleanup:get_map_state");
    expect(driver.live()).toEqual([]);
  });

  it("renders a late frame at 1 rather than past it", () => {
    // A busy tab can skip a whole second. p must saturate, or the exit easing
    // runs backwards and leaves the effect on screen.
    const { driver, log, tick } = harness();
    driver.play(plan("get_map_state", ["viewport"]));
    tick(9000);
    expect(log.filter((line) => line.startsWith("render:"))).toEqual([
      "render:get_map_state:1.00",
    ]);
    expect(log).toContain("cleanup:get_map_state");
  });

  it("clamps a declared duration to the 2 s law", () => {
    // draw_shape is registered here at a deliberately illegal 9 s.
    const { driver, log, tick } = harness();
    driver.play(plan("draw_shape", ["drawing:1"]));
    tick(1000 + FX_MAX_MS);
    expect(log).toContain("render:draw_shape:1.00");
    expect(driver.live()).toEqual([]);
  });
});

describe("zero residue", () => {
  it("cleans up on completion", () => {
    const { driver, log, tick } = harness();
    driver.play(plan("get_map_state", ["viewport"]));
    tick(3000);
    expect(log.filter((l) => l === "cleanup:get_map_state")).toHaveLength(1);
  });

  it("cleans up exactly once when preempted", () => {
    // Cleanup twice would remove a node the SECOND effect had just built.
    const { driver, log, tick } = harness();
    driver.play(plan("get_map_state", ["viewport"]));
    tick(1200);
    driver.play(plan("get_map_state", ["viewport"], 2));
    tick(1200 + PREEMPT_FADE_MS);
    expect(log.filter((l) => l === "cleanup:get_map_state")).toHaveLength(1);
    tick(4000);
    expect(log.filter((l) => l === "cleanup:get_map_state")).toHaveLength(2);
    expect(driver.live()).toEqual([]);
  });

  it("cleans up everything on teardown, mid-flight included", () => {
    const { driver, log } = harness();
    driver.play(plan("get_map_state", ["viewport"]));
    driver.play(plan("set_map_view", ["camera"], 2));
    driver.stopAll();
    expect(log.filter((l) => l.startsWith("cleanup:")).sort()).toEqual([
      "cleanup:get_map_state",
      "cleanup:set_map_view",
    ]);
    expect(driver.live()).toEqual([]);
  });

  it("cleans up an effect whose render throws, and keeps the frame for the rest", () => {
    // FX is commentary; the map is the product. A single effect that throws
    // mid-flight would otherwise escape the rAF callback, freeze every other
    // effect at the frame it died on and strand their nodes on the map — the
    // exact residue law 2 exists to prevent. It leaves through cleanup, once,
    // and its feed row stops glowing like any other ending.
    const { driver, log, glows, tick } = harness();
    driver.play(plan("boom", ["drawing:1"], 1));
    driver.play(plan("get_map_state", ["viewport"], 2));
    tick(1550);
    expect(log.filter((l) => l === "cleanup:boom")).toHaveLength(1);
    expect(glows).toContainEqual([1, 1]);
    expect(log).toContain("render:get_map_state:0.50");
    expect(driver.live().map((fx) => fx.name)).toEqual(["get_map_state"]);
    tick(2100);
    // Still exactly once: the thrower is gone, not retried and not re-cleaned.
    expect(log.filter((l) => l === "cleanup:boom")).toHaveLength(1);
    expect(driver.live()).toEqual([]);
  });

  it("clears the feed-row glow whenever an effect ends, however it ended", () => {
    const { driver, glows, tick } = harness();
    driver.play(plan("get_map_state", ["viewport"], 5));
    tick(1200);
    driver.play(plan("get_map_state", ["viewport"], 6));
    expect(glows).toContainEqual([5, 1]);
    driver.stopAll();
    expect(glows.filter(([seq, p]) => seq === 6 && p === 1)).not.toHaveLength(0);
  });
});

describe("concurrency", () => {
  it("lets effects on independent targets coexist", () => {
    // Rule 1: a camera flight and a shape being drawn are two true things
    // happening at once, and the map should say so.
    const { driver, tick } = harness();
    driver.play(plan("get_map_state", ["viewport"]));
    driver.play(plan("set_map_view", ["camera"], 2));
    tick(1200);
    expect(driver.live()).toHaveLength(2);
  });

  it("fast-fades the running effect when a new one claims the same target", () => {
    const { driver, tick } = harness();
    driver.play(plan("get_map_state", ["viewport"], 1));
    tick(1200);
    driver.play(plan("get_map_state", ["viewport"], 2));
    // The preempted one is already out of `live`: it is leaving, not playing.
    expect(driver.live().map((fx) => fx.seq)).toEqual([2]);
  });

  it("preempts by identity, so a re-fired call replaces itself", () => {
    const { driver, log, tick } = harness();
    driver.play(plan("set_map_view", ["camera"], 1));
    tick(1100);
    driver.play(plan("set_map_view", ["camera"], 2));
    tick(1100 + PREEMPT_FADE_MS);
    expect(log.filter((l) => l === "cleanup:set_map_view")).toHaveLength(1);
    expect(driver.live()).toHaveLength(1);
  });
});

describe("what the surface is told", () => {
  it("announces the survivors as soon as one effect ends, not when the last does", () => {
    // `onChange` is the driver's only output: FxLayer turns it into
    // `data-fx-playing` / `data-fx-count`, which is how QA and a judge's
    // console learn what the map is doing. Announcing only once the loop runs
    // dry means a short effect keeps being claimed as live for as long as a
    // longer neighbour survives it — the badge lies, and an e2e that waits for
    // it to clear passes on stale text.
    const { driver, changes, tick } = harness();
    driver.play(plan("get_map_state", ["viewport"], 1)); // 1100 ms
    driver.play(plan("set_map_view", ["camera"], 2)); // 1300 ms, independent key
    tick(2100); // the short one is done; the long one has 200 ms left
    const announced = changes.at(-1) ?? [];
    expect(announced.map((fx) => fx.name)).toEqual(["set_map_view"]);
    // And it is never allowed to disagree with the driver's own answer.
    expect(announced).toEqual(driver.live());
  });
});

describe("the kill switch", () => {
  it("jumps to the final state and cleans up, with no frame ever scheduled", () => {
    // e2e sets body[data-fx="off"]; a screenshot then has to be the calm map.
    const { driver, log, queue } = harness({ killed: true });
    expect(driver.play(plan("get_map_state", ["viewport"]))).toBeNull();
    expect(log).toEqual(["setup:get_map_state", "render:get_map_state:1.00", "cleanup:get_map_state"]);
    expect(queue).toHaveLength(0);
    expect(driver.live()).toEqual([]);
  });
});

describe("reduced motion", () => {
  it("swaps in the opacity-only variant on its own short clock", () => {
    const { driver, log, tick } = harness({ reduced: true });
    driver.play(plan("get_map_state", ["viewport"]));
    tick(1000 + RM_MS / 2);
    expect(log).toContain("rm:get_map_state:0.50");
    expect(log.some((l) => l.startsWith("render:"))).toBe(false);
    tick(1000 + RM_MS);
    expect(log).toContain("cleanup:get_map_state");
  });
});

describe("degradation", () => {
  it("plays the feed-row glow alone when the call has no honest geometry", () => {
    // The spec's degradation table: the human still sees which call is
    // speaking; the map simply stays calm.
    const { driver, glows, log, tick } = harness();
    driver.play(plan("describe_surroundings", ["origin:1,2"], 4, { kind: "none" }));
    tick(1000 + GLOW_ONLY_MS / 2);
    expect(glows.some(([seq, p]) => seq === 4 && p > 0 && p < 1)).toBe(true);
    expect(log).toEqual([]);
    tick(1000 + GLOW_ONLY_MS);
    expect(driver.live()).toEqual([]);
  });

  it("degrades the same way when an effect cannot build itself", () => {
    // A map-space effect on a page with no WebGL: no map, no projection, no
    // geometry — and no exception out of a rAF frame either.
    const { driver, glows, tick } = harness();
    const broken: FxEffect<Ctx> = {
      dur: 1000,
      setup: () => {
        throw new Error("no map");
      },
      render: () => {},
      rm: () => {},
      cleanup: () => {},
    };
    const host = createFxDriver<Ctx>({
      now: () => 0,
      requestFrame: () => 0,
      cancelFrame: () => {},
      killed: () => false,
      reduced: () => false,
      glow: (seq, p) => glows.push([seq, p]),
      effect: () => broken,
      context: { log: [] },
    });
    expect(() => host.play(plan("measure", ["drawing:1"], 9))).not.toThrow();
    expect(host.live()).toHaveLength(1);
    void driver;
    void tick;
  });
});
