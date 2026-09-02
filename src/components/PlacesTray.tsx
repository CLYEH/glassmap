"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { isAgentState } from "@/lib/awaken";
import { useMapStore } from "@/lib/store/map-store";
import type { Tier2Category } from "@/lib/store/tier2";
import { MapKey } from "./MapKey";
import { BROWSE_MAX, useBrowseStore } from "./browse-store";
import { TIER2_PLURAL } from "./category-labels";
import { TRAY_ORDER, trayCount } from "./places-model";
import { loadedCategoryRows } from "./tier2-disclosure";
import { useAwakenMode } from "./useAwakenMode";
import { usePublishedBox } from "./usePublishedBox";

const number = (n: number) => n.toLocaleString("en-US");

/**
 * Places: the browse affordance, and the one thing on this map a person can do
 * that used to need an agent.
 *
 * The map ships with six painted datasets and eighteen more a *tool* could
 * load. That asymmetry was the whole reason the landing page needed an agent to
 * be interesting: a human could see 2,063 places and ask for none of the 31,000
 * others. This tray is both halves of that sentence — `MapKey` for what is on
 * the map already, the grid for what a tap can add, with the manifest's counts
 * beside each row — so "show me the cafés" is a tap, and the rose ring the
 * layer draws says who asked for them.
 *
 * One surface, because it is one question. The six painted datasets used to be
 * a separate pill in the other bottom corner, which meant a person looking for
 * "places" found two answers on the same edge of the screen and had to work out
 * which one they were reading. The two counts still never mix: the pill's total
 * and the key's rows are the painted six (they sum, see `bundledKeyRows`),
 * while the grid's numbers are what the manifest says a file holds.
 *
 * Grid counts come from `/data/tier2/index.json`, fetched on the first open
 * rather than at load: a landing page that never opens the tray makes no
 * request for it. Until it lands the rows say "…" — an honest "not counted yet"
 * rather than a zero the map would be lying about. The pill's total says the
 * same "…" for the same reason, until the bundled data is in the store.
 *
 * Up to three kinds at once (`BROWSE_MAX`), which makes the grid a set of
 * toggles rather than a menu of one. Two things follow. The chips carry
 * `aria-pressed` each, because a fourth tap does not undo the third — it adds.
 * And the tray no longer closes on a pick: closing after the first of three
 * taps would make a person re-open it twice to do the thing the cap now
 * allows, and it would hide the foot line at the exact moment the foot has
 * something to say (a fourth pick evicts the oldest, and the human is told
 * which one went).
 */
export function PlacesDock() {
  const mode = useAwakenMode();
  /**
   * The dock's own box, published to the stylesheet as `--dock-w`/`--dock-h`.
   *
   * Everything the bottom bar carries shares this band and none of it can know
   * how big the dock is: nought to three browsed chips, each named, is a
   * 159x39 to 815x177 range that no constant covers. The disclosure strip
   * stops before the width; the bar takes the row above the height the moment
   * a browsed chip makes the dock too wide to share the band. See
   * `usePublishedBox`, `.poi-strip` and `.bottom-bar`.
   */
  const dockRef = useRef<HTMLDivElement>(null);
  usePublishedBox(dockRef, "--dock");
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<Tier2Category | null>(null);
  /** The category a fourth pick pushed off the map, until the next pick. */
  const [evicted, setEvicted] = useState<Tier2Category | null>(null);
  /** The painted six, which is what the pill's total counts — never the POIs. */
  const bundled = useMapStore((s) => s.features.length);
  const manifest = useMapStore((s) => s.tier2Manifest);
  const loadManifest = useMapStore((s) => s.loadTier2Manifest);
  const tier2Loaded = useMapStore((s) => s.tier2Loaded);
  const tier2Features = useMapStore((s) => s.tier2Features);
  const agentState = useMapStore(isAgentState);
  const categories = useBrowseStore((s) => s.categories);
  const pending = useBrowseStore((s) => s.pending);
  const browse = useBrowseStore((s) => s.browse);
  const remove = useBrowseStore((s) => s.remove);

  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const entry of manifest?.categories ?? []) tally.set(entry.category, entry.count);
    return tally;
  }, [manifest]);

  /** What the map is actually holding per browsed category — never the file's number. */
  const loadedCounts = useMemo(() => {
    const rows = loadedCategoryRows(tier2Loaded, tier2Features);
    return new Map(rows.map((row) => [row.category, row.count]));
  }, [tier2Loaded, tier2Features]);

  const toggle = useCallback(() => {
    setOpen((value) => {
      // Lazily, and only ever once: `loadTier2Manifest` is idempotent and
      // caches in the store, so a person opening and closing the tray does not
      // re-fetch the index.
      if (!value && manifest === null) void loadManifest();
      return !value;
    });
  }, [manifest, loadManifest]);

  const drop = useCallback(
    (category: Tier2Category) => {
      setFailed(null);
      setEvicted(null);
      remove(category);
    },
    [remove],
  );

  const pick = useCallback(
    async (next: Tier2Category) => {
      setFailed(null);
      setEvicted(null);
      // The live set, not this render's: two taps inside one frame both run
      // against the same stale props, and the second would report a category
      // that is merely still loading as one that could not load.
      const { categories, pending: inFlight } = useBrowseStore.getState();
      if (inFlight.includes(next)) return;
      if (categories.includes(next)) {
        drop(next);
        return;
      }
      const wasEvicted = await browse(next);
      // `browse` swallows a failed load on purpose (a category that would not
      // load must paint nothing), so the tray asks the store what actually
      // happened rather than assuming the tap worked. The eviction is the
      // store's answer too, for a sharper reason: a set compared across this
      // await cannot tell what the cap pushed out from what the human closed
      // with its × while the file was arriving, and would blame the cap for
      // their own tap.
      if (!useBrowseStore.getState().categories.includes(next)) setFailed(next);
      else setEvicted(wasEvicted);
    },
    [browse, drop],
  );

  return (
    <div className="dock" ref={dockRef} data-testid="places-dock" data-tray-open={open}>
      <div className="tray lg deep" data-testid="places-tray" hidden={!open}>
        <span aria-hidden className="caustic" />
        <div className="tray-head">
          <h3>Places</h3>
          <span>lives in this map, not on a server</span>
        </div>

        {/* Both sections scroll together, and only they do: the tray opens
            upward from the dock, so on a short screen (a phone held sideways is
            390px tall) an un-capped tray runs off the top and takes the key —
            the first thing in it — with it. The head and the foot stay put,
            because the foot is the OpenStreetMap attribution. */}
        <div className="tray-body">
          {/* What is already painted, before what a tap could add: a person
              reading downward gets the map they are looking at first. */}
          <MapKey />

          <section className="tray-sec">
            <div className="tray-sec-head">
              <h4>More places</h4>
              <span>tap up to three to load them onto the map</span>
            </div>
            <div className="tray-grid">
              {TRAY_ORDER.map((c) => {
                const count = counts.get(c);
                const loading = pending.includes(c);
                const active = categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className={`place-chip${active ? " active" : ""}`}
                    data-testid="place-chip"
                    data-category={c}
                    data-loading={loading || undefined}
                    aria-pressed={active}
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
          </section>
        </div>

        {/* The foot says the one thing that just happened, and otherwise the
            licence. An eviction has to be said out loud here: a fourth tap
            takes a category off the map, and a person who is not told which
            one is left comparing the strip against their own memory of what
            they asked for. */}
        <p className="tray-foot" data-testid="places-foot">
          {failed
            ? `${TIER2_PLURAL[failed]} could not load — the file did not arrive. Try again.`
            : evicted
              ? `${TIER2_PLURAL[evicted]} came off the map — ${BROWSE_MAX} kinds of place at a time.`
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
        {/* The scale of the map, stated on the landing screen without opening
            anything — the one thing the old bottom-left pill said that a person
            got for free. The painted six only; see `MapKey`. */}
        <span className="dock-n" data-testid="legend-total">
          {bundled > 0 ? number(bundled) : "…"}
        </span>
        <svg className="caret" width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>

      {/* What is painted right now, one chip per kind, in the order they were
          asked for — which is also the order they leave in, so the leftmost
          chip is the one a fourth pick would replace. Each carries its own ×
          because they are three separate answers, not one selection. */}
      {categories.length > 0 && (
        <div
          className="dock-actives"
          data-testid="places-active"
          data-categories={categories.join(",")}
        >
          {categories.map((c) => (
            <div
              key={c}
              className="dock-active lg"
              data-testid="places-active-item"
              data-category={c}
            >
              <span aria-hidden className="swatch" />
              <b>{TIER2_PLURAL[c]}</b>
              <span className="n" data-testid="places-active-count">
                {number(loadedCounts.get(c) ?? 0)} loaded
              </span>
              <button
                type="button"
                className="x"
                data-testid="places-clear"
                data-category={c}
                aria-label={`Stop showing ${TIER2_PLURAL[c]}`}
                onClick={() => drop(c)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* The landing sentence: what a person can do here, before anything has
          happened. It goes the moment they do any of it — a hint that outlives
          its own advice is furniture. It survives into `waking` so the
          awakening can fade it out in its first tenth: unmounted on the first
          frame instead, it would vanish with a pop while everything else in
          the transition travels.

          Gated on the *map's* state and not on which chrome is on screen: a
          person who closes the agent view (T-93) is looking at a map an agent
          has drawn on, and a landing hint returning over it would be advice for
          a page that no longer exists. `isAgentState` is the same sentence the
          awakening reads (`lib/awaken`), so the hint and the mode cannot
          disagree about whether anything has happened here. */}
      {(mode === "waking" || !agentState) && categories.length === 0 && !open ? (
        <p className="hint lg" data-testid="map-hint">
          Explore Taipei — tap a place, draw a shape, or browse <b>Places</b>.
        </p>
      ) : null}
    </div>
  );
}
