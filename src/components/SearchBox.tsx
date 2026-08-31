"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { useMapStore } from "@/lib/store/map-store";
import {
  SEARCH_ZOOM,
  formatDistance,
  searchLoadedFeatures,
  type SearchHit,
} from "./search-model";

/**
 * The search box: "where is X" without an agent in the room.
 *
 * It is the last visible hole in the "usable without an agent" story. A person
 * landing here could pan, tap a place, draw, note, share and browse whole
 * categories from the Places tray — but the one question anybody actually
 * arrives at a map with, *where is X*, could only be asked by an agent through
 * `find_features`. This box asks it of the same data, with no agent present.
 *
 * **It calls no tool, and that is the point.** It reads the store's loaded
 * features through `search-model.ts` and writes exactly one thing back: the
 * selection the person picked, attributed `"user"`. A keystroke here therefore
 * records no activity, wakes no agent chrome (`lib/awaken` reads `activity`
 * and `restoredAgentState`, neither of which this touches) and is invisible
 * through `modelContext` — the same law the browse tray works under
 * (`browse-store.ts`). What the agent can see afterwards is what a tap on the
 * map would also have left: a selected place, recorded as the human's.
 *
 * **It is not a modal.** No backdrop, no focus trap beyond the input's own
 * dropdown, no `alert`/`confirm`/`prompt` (CONTRIBUTING). The map keeps
 * panning under it, every tool keeps answering while it is open, and Esc or a
 * blur closes it. Full keyboard: ↓/↑ walk the rows, Enter picks, Esc closes
 * and — on an already-closed box — clears.
 *
 * **Where it sits.** Top-left, directly under the brand: the place a person
 * looks for search on a map, in the column the agent chrome does not start in
 * until it arrives (globals.css moves the feed and the ticker down to below
 * it). The human surface is the fixed point; the agent's surfaces arrive
 * around it rather than moving it.
 */
export function SearchBox() {
  const features = useMapStore((s) => s.features);
  const tier2Features = useMapStore((s) => s.tier2Features);
  const tier2Loaded = useMapStore((s) => s.tier2Loaded);
  const bounds = useMapStore((s) => s.bounds);
  const view = useMapStore((s) => s.view);
  const setSelection = useMapStore((s) => s.setSelection);
  const setView = useMapStore((s) => s.setView);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** Which row ↓/↑ has walked to. Clamped at render, never in an effect. */
  const [active, setActive] = useState(0);

  const answer = useMemo(
    () =>
      searchLoadedFeatures({
        features,
        tier2Features,
        query,
        bounds,
        origin: view.center,
        loadedCategories: tier2Loaded,
      }),
    [features, tier2Features, query, bounds, view.center, tier2Loaded],
  );

  const hits = answer.hits;
  /** Open *and* asked something: focusing an empty box shows nothing. */
  const showing = open && query.trim() !== "";
  // The result list shrinks under the cursor as a person types, so the walked
  // row is clamped here rather than corrected by an effect — React 19's
  // `set-state-in-effect` rule is on, and the DOM already knows the length.
  const activeIndex = hits.length === 0 ? -1 : Math.min(active, hits.length - 1);

  const choose = useCallback(
    (hit: SearchHit) => {
      // A person's own act, recorded as one: `"user"` is what keeps the bead
      // rose, keeps the id in the `su` key of any link this page writes, and
      // lets the card say "you tapped it" rather than hedging (T-80).
      setSelection([hit.id], "user");
      // The camera eases because the map mirrors the store (MapCanvas's
      // `applyView` flies to whatever `view` becomes). Never zooms out: a
      // person who framed a neighbourhood keeps their frame.
      setView({ center: hit.center, zoom: Math.max(view.zoom, SEARCH_ZOOM) });
      setOpen(false);
    },
    [setSelection, setView, view.zoom],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!showing) {
        setOpen(true);
        setActive(0);
      } else setActive((index) => Math.min(index + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const hit = hits[activeIndex];
      if (hit) {
        event.preventDefault();
        choose(hit);
      }
    } else if (event.key === "Escape") {
      // Two steps, not one: the first Esc puts the map back, the second gives
      // the box back. Neither ever takes the map away from anything else.
      if (showing) setOpen(false);
      else setQuery("");
    }
  };

  return (
    <div className="search-box" data-testid="search-box" data-open={showing}>
      <div className="search-field lg lens">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
          <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9.2 9.2L12.4 12.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          className="search-input"
          data-testid="search-input"
          placeholder="Search this map"
          aria-label="Search places on this map"
          role="combobox"
          aria-expanded={showing}
          // Only when there is a list to control: with no hits the popup is
          // the honesty note, and pointing at an id nothing renders would be
          // a broken reference rather than a hint.
          aria-controls={showing && hits.length > 0 ? "search-results" : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 && showing ? `search-row-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>

      {showing ? (
        <div className="search-drop lg deep">
          {hits.length > 0 ? (
            <ul
              className="search-list"
              id="search-results"
              data-testid="search-results"
              data-count={hits.length}
              data-total={answer.total}
              role="listbox"
              aria-label="Search results"
            >
              {hits.map((hit, index) => (
                <li
                  key={hit.id}
                  id={`search-row-${index}`}
                  className={`search-row${index === activeIndex ? " on" : ""}`}
                  data-testid="search-result"
                  data-feature-id={hit.id}
                  data-in-view={hit.inView}
                  role="option"
                  aria-selected={index === activeIndex}
                  // The row is picked on mousedown-then-click, so the default
                  // mousedown (which blurs the input) is refused: without it
                  // the blur closes the dropdown before the click lands on it.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(hit)}
                >
                  <span aria-hidden className="sr-dot" style={{ background: hit.swatch }} />
                  <span className="sr-main">
                    <span className="sr-name">{hit.name}</span>
                    {/* The second name, when the data carries one that is not
                        the headline: the T-96 pattern, secondary by size and
                        colour, never a replacement. */}
                    {hit.nameEn ? <span className="sr-name-en">{hit.nameEn}</span> : null}
                  </span>
                  <span className="sr-what">{hit.what}</span>
                  <span className="sr-d" data-testid="search-distance">
                    {formatDistance(hit.distanceM)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            /* Nothing matched — and the honest reason why, when there is one.
               "No results" over a map holding 18 unfetched categories would be
               the exact lie the tools refuse to tell ("no cafes here" vs "the
               cafe file was never fetched"). It points at the tray rather than
               fetching anything: loading a category is a deliberate act. */
            <p className="search-note" data-testid="search-empty">
              {answer.unfetchedCategories > 0
                ? `Nothing loaded matches that — ${answer.unfetchedCategories} more kinds of place load from the Places tray.`
                : "Nothing on this map matches that."}
            </p>
          )}
          {answer.overflow > 0 ? (
            <p className="search-note" data-testid="search-overflow">
              {answer.overflow} more — zoom in or refine
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
