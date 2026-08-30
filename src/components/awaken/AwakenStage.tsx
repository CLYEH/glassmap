"use client";

import { useEffect, useRef } from "react";
import { useAwakenStore } from "./mode-store";
import { awakenDevHandle, finalPositions, landAwake, takePendingFreeze } from "./controller";
import { playAwakening, type AwakenPlayer, type AwakenStageNodes } from "./choreography";

const isDev = process.env.NODE_ENV !== "production";

declare global {
  interface Window {
    /**
     * Dev/QA handle on the awakening, alongside `window.__glassmapFx` and
     * `window.__glassmapStore`. `freeze(p)` holds any beat of the story so a
     * still is reproducible; `replay()` plays it again. Not set in production
     * builds — a visitor gets one arrival, and there is no product path that
     * replays it.
     */
    __glassmapAwaken?: typeof awakenDevHandle;
  }
}

/**
 * The awakening's own surfaces: the light it is made of, and the caption it
 * ends on.
 *
 * Mounted once, beside `FxLayer`, and for the same reasons — everything here
 * is driven imperatively at 60 fps, the elements are `pointer-events: none`
 * (except the toast, which is a control), and none of it is ever the page's
 * content. The light is three emitters: the **flare** at the spark's true
 * position, the **ripple** that crosses the glass from it, and the **bloom**
 * the feed condenses out of, plus a **sheen** that sweeps the hardened slab
 * and the **lit edge** the inspector pane arrives behind. All of them are
 * additive (`plus-lighter`): on a dark tinted panel, brightness-on-tint
 * renders grey mud, and light has to *emit*.
 *
 * The caption is not FX. It is a toast — session chrome that outlives the
 * transition by ~3.2 s — so it is a real element with `role="status"`, a
 * dismiss button and `inert` while hidden, rather than a painted string. Its
 * dwell, its Esc listener and its three dismiss paths live in the choreography
 * with the clock that raises it, which is what lets "which listeners are armed
 * at completion / after dismissal / after teardown" be one answer instead of
 * three modules' worth of guessing.
 */
export function AwakenStage() {
  const mode = useAwakenStore((s) => s.mode);
  const stageRef = useRef<HTMLDivElement>(null);
  const flareRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);
  const bloomRef = useRef<HTMLDivElement>(null);
  const sheenRef = useRef<HTMLDivElement>(null);
  const laneEdgeRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  // Declared first so its cleanup runs first: React destroys effects in the
  // order they were created, so by the time the story's cleanup runs on an
  // unmount, this has already said the component is going away. That is the
  // whole difference between "the mode changed because the story ended" (keep
  // the toast) and "the tree is coming down" (take everything with it).
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== "waking") return;
    const nodes: AwakenStageNodes | null =
      stageRef.current &&
      flareRef.current &&
      rippleRef.current &&
      bloomRef.current &&
      sheenRef.current &&
      laneEdgeRef.current &&
      captionRef.current
        ? {
            stage: stageRef.current,
            flare: flareRef.current,
            ripple: rippleRef.current,
            bloom: bloomRef.current,
            sheen: sheenRef.current,
            laneEdge: laneEdgeRef.current,
            caption: captionRef.current,
          }
        : null;
    if (!nodes) return;

    // This effect runs on the commit that *mounted* the agent chrome (the feed,
    // the lane, the ticker are rendered from the same mode), so the panels the
    // story moves are in the DOM and measurable before the first frame.
    const player: AwakenPlayer = playAwakening({
      nodes,
      onLand: landAwake,
      finalPositions,
      freezeAt: takePendingFreeze(),
    });
    return () => {
      if (live.current && player.landed()) player.detach();
      else player.cancel();
    };
  }, [mode]);

  useEffect(() => {
    if (!isDev) return;
    window.__glassmapAwaken = awakenDevHandle;
    return () => {
      delete window.__glassmapAwaken;
    };
  }, []);

  return (
    <>
      {/* No z-index on the wrapper: it must not open a stacking context, or the
          light below could not sit under the feed while the flare sits over it. */}
      <div ref={stageRef} className="awaken-stage" data-testid="awaken-stage" aria-hidden>
        <div ref={bloomRef} className="awaken-bloom" />
        <div ref={sheenRef} className="awaken-sheen">
          <i />
        </div>
        <div ref={laneEdgeRef} className="awaken-lane-edge" />
        <div ref={rippleRef} className="awaken-ripple" />
        <div ref={flareRef} className="awaken-flare" />
      </div>

      {/* The toast. `role="status"` + `aria-live="polite"` so the arrival is
          announced rather than only drawn; `inert` while hidden so Tab can
          never land on an invisible control. Tap anywhere on it dismisses (the
          × is the keyboard path, and its click bubbles here), Esc while it
          shows does the same. No `alert`/`confirm` anywhere near it: a modal
          would freeze the very agent this is announcing. */}
      <div
        ref={captionRef}
        className="awaken-cap lg"
        data-testid="awaken-caption"
        data-shown="false"
        role="status"
        aria-live="polite"
        inert
      >
        <svg className="cap-spark" width="13" height="13" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
          <path d="M7 0l1.6 5.4L14 7l-5.4 1.6L7 14 5.4 8.6 0 7l5.4-1.6z" />
        </svg>
        An agent joined this map
        <button type="button" className="cap-x" data-testid="awaken-caption-dismiss" aria-label="Dismiss">
          ×
        </button>
      </div>
    </>
  );
}
