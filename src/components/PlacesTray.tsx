"use client";

import { useCallback, useMemo, useState } from "react";
import { useMapStore } from "@/lib/store/map-store";
import type { Tier2Category } from "@/lib/store/tier2";
import { useBrowseStore } from "./browse-store";
import { TIER2_PLURAL } from "./category-labels";
import { TRAY_ORDER, trayCount } from "./places-model";
import { loadedCategoryRows } from "./tier2-disclosure";
import { useAwakenMode } from "./useAwakenMode";

const number = (n: number) => n.toLocaleString("en-US");

/**
 * Places: the browse affordance, and the one thing on this map a person can do
 * that used to need an agent.
 *
 * The map ships with six painted datasets and eighteen more a *tool* could
 * load. That asymmetry was the whole reason the landing page needed an agent to
 * be interesting: a human could see 2,063 places and ask for none of the 31,000
 * others. This tray is that list, in English, with the manifest's counts beside
 * each row — so "show me the cafés" is a tap, and the rose ring the layer draws
 * says who asked for them.
 *
 * Counts come from `/data/tier2/index.json`, fetched on the first open rather
 * than at load: a landing page that never opens the tray makes no request for
 * it. Until it lands the rows say "…" — an honest "not counted yet" rather than
 * a zero the map would be lying about.
 */
export function PlacesDock() {
  const mode = useAwakenMode();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Tier2Category | null>(null);
  const [failed, setFailed] = useState<Tier2Category | null>(null);
  const manifest = useMapStore((s) => s.tier2Manifest);
  const loadManifest = useMapStore((s) => s.loadTier2Manifest);
  const tier2Loaded = useMapStore((s) => s.tier2Loaded);
  const tier2Features = useMapStore((s) => s.tier2Features);
  const category = useBrowseStore((s) => s.category);
  const browse = useBrowseStore((s) => s.browse);
  const clear = useBrowseStore((s) => s.clear);

  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const entry of manifest?.categories ?? []) tally.set(entry.category, entry.count);
    return tally;
  }, [manifest]);

  /** What the map is actually holding for the browsed category — never the file's number. */
  const loadedCount = useMemo(() => {
    if (category === null) return 0;
    const row = loadedCategoryRows(tier2Loaded, tier2Features).find(
      (r) => r.category === category,
    );
    return row?.count ?? 0;
  }, [category, tier2Loaded, tier2Features]);

  const toggle = useCallback(() => {
    setOpen((value) => {
      // Lazily, and only ever once: `loadTier2Manifest` is idempotent and
      // caches in the store, so a person opening and closing the tray does not
      // re-fetch the index.
      if (!value && manifest === null) void loadManifest();
      return !value;
    });
  }, [manifest, loadManifest]);

  const pick = useCallback(
    async (next: Tier2Category) => {
      setFailed(null);
      if (next === category) {
        clear();
        return;
      }
      setPending(next);
      await browse(next);
      setPending(null);
      // `browse` swallows a failed load on purpose (a category that would not
      // load must paint nothing), so the tray asks the store what actually
      // happened rather than assuming the tap worked.
      if (useBrowseStore.getState().category !== next) setFailed(next);
      else setOpen(false);
    },
    [browse, clear, category],
  );

  return (
    <div className="dock" data-testid="places-dock" data-tray-open={open}>
      <div className="tray lg deep" data-testid="places-tray" hidden={!open}>
        <span aria-hidden className="caustic" />
        <div className="tray-head">
          <h3>Places</h3>
          <span>tap to see a kind of place · lives in this map, not on a server</span>
        </div>
        <div className="tray-grid">
          {TRAY_ORDER.map((c) => {
            const count = counts.get(c);
            const loading = pending === c;
            return (
              <button
                key={c}
                type="button"
                className={`place-chip${category === c ? " active" : ""}`}
                data-testid="place-chip"
                data-category={c}
                data-loading={loading || undefined}
                aria-pressed={category === c}
                onClick={() => void pick(c)}
              >
                <span className="pl">{TIER2_PLURAL[c]}</span>
                <span className="pn">
                  {loading ? "loading…" : count === undefined ? "…" : trayCount(count)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="tray-foot" data-testid="places-foot">
          {failed
            ? `${TIER2_PLURAL[failed]} could not load — the file did not arrive. Try again.`
            : "Data © OpenStreetMap contributors · loads on demand, drawn with a rose ring because you asked for it"}
        </p>
      </div>

      <button
        type="button"
        className="dock-pill lg lens"
        data-testid="places-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
          <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="10.2" cy="4.6" r="1.5" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="6.4" cy="10" r="1.8" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        Places
        <svg className="caret" width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>

      {category !== null && (
        <div className="dock-active lg" data-testid="places-active" data-category={category}>
          <span aria-hidden className="swatch" />
          <b>{TIER2_PLURAL[category]}</b>
          <span className="n" data-testid="places-active-count">
            {number(loadedCount)} loaded
          </span>
          <button
            type="button"
            className="x"
            data-testid="places-clear"
            aria-label={`Stop showing ${TIER2_PLURAL[category]}`}
            onClick={() => clear()}
          >
            ×
          </button>
        </div>
      )}

      {/* The landing sentence: what a person can do here, before anything has
          happened. It goes the moment they do any of it — a hint that outlives
          its own advice is furniture. It survives into `waking` so the
          awakening can fade it out in its first tenth: unmounted on the first
          frame instead, it would vanish with a pop while everything else in
          the transition travels. */}
      {mode !== "awake" && category === null && !open ? (
        <p className="hint lg" data-testid="map-hint">
          Explore Taipei — tap a place, draw a shape, or browse <b>Places</b>.
        </p>
      ) : null}
    </div>
  );
}
