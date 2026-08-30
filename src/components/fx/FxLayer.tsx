"use client";

import { useEffect, useRef } from "react";
import type { GlassMapFeature } from "@/lib/data/schema";
import type { MapFeature } from "@/lib/store/tier2";
import { useMapStore, type LngLat } from "@/lib/store/map-store";
import { createFxDriver, type FxDriver, type LiveFx } from "./driver";
import { seg } from "./easing";
import { fxEffect } from "./effects";
import { onHumanFx } from "./human-events";
import { centroidOf, planForEntry, planForHuman, type FxSource } from "./plan";
import { createFxContext, type FxContext } from "./surfaces";

const isDev = process.env.NODE_ENV !== "production";

declare global {
  interface Window {
    /**
     * Dev/QA handle on the FX driver, alongside `window.__glassmapMap` and
     * `window.__glassmapStore`. Not set in production builds — the shipped
     * assertion surface is `fx-viewport`'s `data-fx-*` attributes, which work
     * in any build.
     */
    __glassmapFx?: FxDriver;
  }
}

/**
 * Where each feature sits, by id, rebuilt only when one of the two feature
 * arrays is replaced. A 2,000-feature scan per selected id would otherwise be
 * quadratic in a selection an agent is free to make as large as it likes.
 */
function makeAnchorIndex() {
  let lastBundled: readonly GlassMapFeature[] | null = null;
  let lastTier2: readonly MapFeature[] | null = null;
  let index = new Map<string, LngLat>();
  return (bundled: readonly GlassMapFeature[], tier2: readonly MapFeature[]) => {
    if (bundled === lastBundled && tier2 === lastTier2) return index;
    lastBundled = bundled;
    lastTier2 = tier2;
    index = new Map<string, LngLat>();
    // Bundled features win a shared id — the same precedence the selection
    // halo applies in `selectionAnchorsToGeoJson`.
    for (const feature of tier2) {
      const at = centroidOf(feature.geometry);
      if (at) index.set(feature.properties.id, at);
    }
    for (const feature of bundled) {
      const at = centroidOf(feature.geometry);
      if (at) index.set(feature.properties.id, at);
    }
    return index;
  };
}

/**
 * The feed-row glow: the row a call made, lit on that call's own effect clock.
 *
 * Keyed by `entry.seq` and re-queried every frame, never by list index — the
 * feed folds runs of reads into one row and re-renders as calls land, so an
 * index would drift onto the wrong call the moment two effects overlap. Both
 * feeds (the desktop panel and the sheet's Activity tab) render from the same
 * slice, so writing to every match keeps them in step for free.
 */
function makeGlow() {
  const lit = new Set<number>();
  const rowsFor = (seq: number) =>
    document.querySelectorAll<HTMLElement>(
      `[data-testid="activity-call"][data-seq="${seq}"]`,
    );
  const paint = (seq: number, opacity: number) => {
    const on = opacity > 0.004;
    for (const row of rowsFor(seq)) {
      row.style.background = on ? `rgba(45,212,191,${(0.1 * opacity).toFixed(4)})` : "";
      row.style.borderRadius = on ? "8px" : "";
      row.style.boxShadow = on
        ? `inset 2px 0 0 rgba(45,212,191,${(0.55 * opacity).toFixed(4)})`
        : "";
    }
    if (on) lit.add(seq);
    else lit.delete(seq);
  };
  return {
    glow(seq: number, p: number) {
      paint(seq, p >= 1 ? 0 : seg(p, 0, 0.12) * (1 - seg(p, 0.72, 1)));
    },
    clear() {
      for (const seq of [...lit]) paint(seq, 0);
    },
  };
}

/**
 * The agent-presence FX layer: two surfaces and one driver, mirroring the store
 * the same way the map does.
 *
 * Everything is imperative for the same reason `MapCanvas` is: the driver runs
 * inside `requestAnimationFrame`, not inside a render, and a React state write
 * per frame would re-render the whole page sixty times a second. The component
 * renders two empty layers and never renders again.
 *
 * The kill switch is `body[data-fx="off"]`. This layer WRITES that attribute on
 * mount — `"off"` for `?fx=off`, `"on"` otherwise, and never over a value that
 * is already there unless `?fx=off` says otherwise — so "is FX running on this
 * page" is one attribute to read and one attribute to set, for e2e and for a
 * judge's console alike.
 */
export function FxLayer() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const overlay = overlayRef.current;
    if (!viewport || !overlay) return;

    const params = new URLSearchParams(window.location.search);
    const body = document.body;
    if (params.get("fx") === "off") body.dataset.fx = "off";
    else if (!body.dataset.fx) body.dataset.fx = "on";

    const forceReducedMotion = params.get("rm") === "1";
    const context: FxContext = createFxContext(viewport, overlay);
    const anchors = makeAnchorIndex();
    const rowGlow = makeGlow();

    const source = (): FxSource => {
      const state = useMapStore.getState();
      const index = anchors(state.features, state.tier2Features);
      return {
        view: state.view,
        drawings: state.drawings,
        annotations: state.annotations,
        selection: state.selection,
        anchorOf: (id) => index.get(id) ?? null,
      };
    };

    const announce = (live: readonly LiveFx[]) => {
      viewport.dataset.fxPlaying = live.map((fx) => fx.name).join(",");
      viewport.dataset.fxCount = String(live.length);
    };

    const driver = createFxDriver<FxContext>({
      now: () => performance.now(),
      requestFrame: (cb) => window.requestAnimationFrame(cb),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
      // Re-read every play: e2e flips the switch mid-session, and the page
      // must obey from the very next call.
      killed: () => document.body.dataset.fx === "off",
      reduced: () =>
        forceReducedMotion ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      glow: (seq, p) => rowGlow.glow(seq, p),
      onChange: announce,
      effect: fxEffect,
      context,
    });
    announce([]);
    if (isDev) window.__glassmapFx = driver;

    // Calls that landed before this layer mounted (a share link's restore, a
    // tool the agent fired during hydration) are history, not news: the map is
    // already showing their result and replaying them would narrate the past.
    let lastSeq = useMapStore.getState().activity.at(-1)?.seq ?? 0;

    const playNew = () => {
      const activity = useMapStore.getState().activity;
      const fresh = activity.filter((entry) => entry.seq > lastSeq);
      if (fresh.length === 0) return;
      lastSeq = fresh[fresh.length - 1].seq;
      const now = source();
      for (const entry of fresh) {
        const plan = planForEntry(entry, now);
        if (plan) driver.play(plan);
      }
    };

    const unsubscribeStore = useMapStore.subscribe((state, previous) => {
      if (state.activity !== previous.activity) playNew();
    });

    const unsubscribeHuman = onHumanFx((event) => {
      const plan = planForHuman(event);
      if (plan) driver.play(plan);
    });

    return () => {
      unsubscribeStore();
      unsubscribeHuman();
      driver.stopAll();
      rowGlow.clear();
      if (isDev) delete window.__glassmapFx;
    };
  }, []);

  return (
    <>
      {/* Map space: rings, ticks, dots, runners and pens, re-projected every
          frame. Under the scrims, like the map furniture it comments on. */}
      <svg ref={overlayRef} className="fx-overlay" data-testid="fx-overlay" aria-hidden />
      {/* Viewport space: the effects whose meaning is the frame itself. Above
          the scrims, below every piece of glass chrome. */}
      <div ref={viewportRef} className="fx-viewport" data-testid="fx-viewport" aria-hidden />
    </>
  );
}
