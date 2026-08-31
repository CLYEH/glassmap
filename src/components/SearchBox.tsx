"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { useMapStore } from "@/lib/store/map-store";
import type { MapCategory, Tier2Category } from "@/lib/store/tier2";
import { BROWSE_MAX, useBrowseStore } from "./browse-store";
import { TIER2_PLURAL } from "./category-labels";
import { trayCount } from "./places-model";
import { searchIndexEntries } from "./search-index-model";
import {
  SEARCH_ZOOM,
  composeSearchRows,
  formatDistance,
  searchEmptyNote,
  searchLoadedFeatures,
  type SearchRow,
} from "./search-model";
import { matchCategoryVocabulary } from "./search-vocabulary";

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
 *
 * ## It knows the whole city, not just what is loaded (T-100)
 *
 * Three lists, in one order, and each one is a different kind of answer:
 *
 *  1. **Places the map is holding** — the rich rows above, selectable, with
 *     their real tags and a colour off the map's own ramp.
 *  2. **Places the city has and this page has not fetched** — from the citywide
 *     index (`search-index-model.ts`), which knows all 31,057 points of
 *     interest whether or not a single category file has been downloaded. These
 *     rows look different on purpose and say *loads on pick*, because accepting
 *     one is not free: it fetches that category before the map can show it.
 *  3. **Kinds of place the words might have meant** — from the bilingual
 *     vocabulary (`search-vocabulary.ts`). "coffee" and its Chinese equivalent
 *     are not the name of anywhere; the honest answer is the offer to paint
 *     every café in Taipei, which is what the Places tray does and what this row
 *     asks it to do.
 *
 * The index and the manifest are fetched on the **first keystroke**, never at
 * load: a landing page that is never searched makes neither request. Typing is
 * never blocked on either — the rows a person can already have appear on the
 * first frame, and the citywide ones arrive underneath them when the file does.
 *
 * ## Picking loads, and the two picks load differently
 *
 * A **citywide row** loads its category and paints nothing
 * (`loadTier2Category`, the store's plain per-category loader). Two reasons,
 * and both would be violated by routing it through the browse tray's
 * `browse()`:
 *
 *  - **A search pick is one place, not a citywide paint.** Someone asking where
 *    a Starbucks is has not asked for 2,298 café beads over their city. The
 *    place they picked is still marked — `applySelectionMarks` in `MapCanvas`
 *    draws a bead for any *selected* point of interest whatever the browse set
 *    is (`selectedPoiFeatures`, map-style.ts) — so the pick is visible without
 *    repainting the map.
 *  - **It must not spend the browse budget.** `browse()` respects `BROWSE_MAX`
 *    by evicting the oldest painted category, so a search pick would silently
 *    take a kind of place the human was looking at off the map. A pick is not
 *    a browse gesture and must not cost one.
 *
 * And it is the *plain* loader, not `restoreTier2Categories`, for a third
 * reason the browse tray does not raise: the restore loader records a failure
 * in `tier2RestoreFailures`, and that list is a claim about a **share link**. A
 * pick whose file never arrived, taken through it, made a page nobody was sent
 * say "couldn't load cafe for this link" (`ShareRestoreNotice`), showed an
 * agent a restore failure in `get_map_state().tier2.failed` — contradicting
 * the invisibility this box promises above — and got the category declared
 * into the next link this page wrote, so a recipient downloaded 573 KB of
 * cafés for a map that never held one. A failed pick is the pick's own news
 * and nobody else's; it is said in one line under the rows and nowhere else.
 *
 * What it does cost is disclosed where every loaded-but-unpainted category is
 * disclosed: the `poi-loaded` strip in the bottom bar (`LoadedCategories`)
 * names it and counts it — the plain loader lands the category in
 * `tier2Loaded` exactly as the restore does, so a pick that works is disclosed
 * as loudly as it ever was. Then the pick behaves exactly like a loaded one —
 * append to the selection as `"user"`, ease the camera, never zoom out.
 *
 * The selection is written **after** the load, never beside it, and never at
 * all unless the feature really arrived: a selected id the store cannot
 * resolve highlights nothing and leaves the inspector holding an inert row.
 * See `chooseIndex`.
 *
 * A **category row** goes through `browse()` instead, because painting *is*
 * what "show me the cafés" means, and it is the same act the tray performs —
 * so it takes the same cap and the same eviction, and says which category came
 * off.
 *
 * The dropdown closes on a pick that worked and nothing else needed saying. It
 * stays open — with one line under the rows — exactly when something went
 * wrong (the file did not arrive) or something left the map (the cap evicted a
 * category), because those are the two outcomes no other surface will report.
 */
export function SearchBox() {
  const features = useMapStore((s) => s.features);
  const tier2Features = useMapStore((s) => s.tier2Features);
  const tier2Loaded = useMapStore((s) => s.tier2Loaded);
  const bounds = useMapStore((s) => s.bounds);
  const view = useMapStore((s) => s.view);
  const selection = useMapStore((s) => s.selection);
  const setSelection = useMapStore((s) => s.setSelection);
  const setView = useMapStore((s) => s.setView);
  const searchIndex = useMapStore((s) => s.searchIndex);
  const searchIndexStatus = useMapStore((s) => s.searchIndexStatus);
  const manifest = useMapStore((s) => s.tier2Manifest);
  const loadCategory = useMapStore((s) => s.loadTier2Category);
  const painted = useBrowseStore((s) => s.categories);
  const browse = useBrowseStore((s) => s.browse);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** Which row ↓/↑ has walked to. Clamped at render, never in an effect. */
  const [active, setActive] = useState(0);
  /** The row whose file is in flight, by `SearchRow.key`; null when idle. */
  const [pending, setPending] = useState<string | null>(null);
  /** The one thing the last pick has to say, or nothing. See the header. */
  const [note, setNote] = useState<{
    kind: "failed" | "evicted" | "stale";
    category: Tier2Category;
  } | null>(null);

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

  const citywide = useMemo(
    () =>
      searchIndexEntries({
        index: searchIndex,
        query,
        bounds,
        origin: view.center,
        loadedCategories: tier2Loaded,
      }),
    [searchIndex, query, bounds, view.center, tier2Loaded],
  );

  /** The manifest's citywide counts, for the "browse this kind" rows. */
  const counts = useMemo(() => {
    const tally = new Map<MapCategory, number>();
    for (const entry of manifest?.categories ?? []) tally.set(entry.category, entry.count);
    return tally;
  }, [manifest]);

  const kinds = useMemo(
    () => matchCategoryVocabulary({ query, counts, painted }),
    [query, counts, painted],
  );

  const rows = useMemo(
    () => composeSearchRows(answer.hits, citywide.hits, kinds),
    [answer.hits, citywide.hits, kinds],
  );

  /** Open *and* asked something: focusing an empty box shows nothing. */
  const showing = open && query.trim() !== "";
  // The result list shrinks under the cursor as a person types, so the walked
  // row is clamped here rather than corrected by an effect — React 19's
  // `set-state-in-effect` rule is on, and the DOM already knows the length.
  const activeIndex = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);

  /**
   * The two files the box needs to answer for the whole city, asked for on the
   * first keystroke and never at load.
   *
   * Read from `getState()` rather than from this render's props so a burst of
   * keystrokes cannot re-ask on stale status. `loadSearchIndex` coalesces (one
   * request in flight per page) and latches a 404 forever, so the only status
   * that re-requests is `failed` — which is deliberate: a dropped connection
   * must not cost the rest of the session its citywide search, and the person
   * is still typing, which is the only retry signal this surface has. At most
   * one request is ever in flight either way.
   */
  const ask = useCallback(() => {
    const state = useMapStore.getState();
    if (state.searchIndexStatus === "idle" || state.searchIndexStatus === "failed") {
      void state.loadSearchIndex();
    }
    // The counts beside a "browse this kind" row. Idempotent and cached in the
    // store — the same call the Places tray makes when it first opens.
    if (state.tier2Manifest === null) void state.loadTier2Manifest();
  }, []);

  const chooseLoaded = useCallback(
    (id: string, center: [number, number]) => {
      // Appended, never replacing — a search pick is the same human gesture as
      // a tap on the map, and human gestures accumulate: clearing the map is
      // its own act (the card's Remove, `select_features({replace: true})`),
      // not a side effect of finding one more place. A replace would have
      // thrown away the three places a person had just tapped, and — because
      // an agent's selection is sometimes the only work a link carries — it
      // would have erased that evidence from every link written afterwards.
      // Same write and same dedupe as `tapFeature` in MapCanvas.
      //
      // `"user"` is what keeps the bead rose, keeps the id in the `su` key of
      // any link this page writes, and lets the card say "you tapped it"
      // rather than hedging (T-80). An id that was already selected keeps
      // whatever the store already recorded about it — this write did not
      // select it (`setSelection`'s single-source rule).
      if (!selection.includes(id)) setSelection([...selection, id], "user");
      // The camera eases because the map mirrors the store (MapCanvas's
      // `applyView` flies to whatever `view` becomes). Never zooms out: a
      // person who framed a neighbourhood keeps their frame.
      setView({ center, zoom: Math.max(view.zoom, SEARCH_ZOOM) });
      setOpen(false);
    },
    [selection, setSelection, setView, view.zoom],
  );

  /**
   * A citywide row: fetch its category, then select and fly exactly as a loaded
   * row does. See the header for why this loads without painting.
   *
   * **The load completes before the selection is written, and nothing selects
   * an id the store cannot resolve.** An index row names a place the map is not
   * holding, and a selected id with no feature behind it is the one outcome
   * this whole path must never produce: it highlights nothing, the card cannot
   * explain it, and the inspector renders it as an inert "not loaded" row with
   * no way out — honest, and indistinguishable from a bug. So the id is written
   * only after its category is in memory *and* the feature is really there;
   * every other outcome says so in words and selects nothing.
   *
   * Everything after the await is read from `getState()`: a category file is
   * hundreds of milliseconds, and this render's `selection` and `view` are the
   * ones from before it — writing them back would undo a tap, a pan or an
   * agent's selection made while the file was arriving.
   */
  const chooseIndex = useCallback(
    async (key: string, id: string, category: Tier2Category, center: [number, number]) => {
      setPending(key);
      setNote(null);
      const result = await loadCategory(category);
      setPending(null);
      // A file that would not load selects nothing: "the file did not arrive"
      // is said out loud, here and only here — the plain loader leaves no
      // restore failure behind for another surface to repeat as a link's news
      // (see the header) — instead of shown as a dead pick.
      if (!result.ok) {
        setNote({ kind: "failed", category });
        return;
      }
      const state = useMapStore.getState();
      // The file arrived and does not contain this place. It means the index
      // and the category file were exported at different times (the generator
      // can refresh one category at a time — scripts/fetch-tier2.mjs `--only`),
      // so the row was a promise this deployment cannot keep. Say that, rather
      // than select an id nothing on the map answers to.
      if (!state.tier2Features.some((feature) => feature.properties.id === id)) {
        setNote({ kind: "stale", category });
        return;
      }
      if (!state.selection.includes(id)) state.setSelection([...state.selection, id], "user");
      state.setView({ center, zoom: Math.max(state.view.zoom, SEARCH_ZOOM) });
      setOpen(false);
    },
    [loadCategory],
  );

  /** A "browse this kind" row: the tray's own act, cap, eviction and all. */
  const chooseCategory = useCallback(
    async (key: string, category: Tier2Category) => {
      setPending(key);
      setNote(null);
      const evicted = await browse(category);
      setPending(null);
      // `browse` swallows a failed load on purpose (a category that would not
      // load must paint nothing), so ask the store what actually happened
      // rather than assuming the pick worked — the same check the tray makes.
      if (!useBrowseStore.getState().categories.includes(category)) {
        setNote({ kind: "failed", category });
        return;
      }
      if (evicted) {
        setNote({ kind: "evicted", category: evicted });
        return;
      }
      setOpen(false);
    },
    [browse],
  );

  const choose = useCallback(
    (row: SearchRow) => {
      // One file at a time: a second pick while the first is in flight would
      // race two loads whose outcomes both want this one note line.
      if (pending) return;
      if (row.kind === "loaded") chooseLoaded(row.hit.id, row.hit.center);
      else if (row.kind === "index") {
        void chooseIndex(row.key, row.hit.id, row.hit.category, row.hit.center);
      } else void chooseCategory(row.key, row.row.category);
    },
    [pending, chooseLoaded, chooseIndex, chooseCategory],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!showing) {
        setOpen(true);
        setActive(0);
      } else setActive((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const row = rows[activeIndex];
      if (row) {
        event.preventDefault();
        choose(row);
      }
    } else if (event.key === "Escape") {
      // Two steps, not one: the first Esc puts the map back, the second gives
      // the box back. Neither ever takes the map away from anything else.
      if (showing) setOpen(false);
      else setQuery("");
    }
  };

  return (
    <div
      className="search-box"
      data-testid="search-box"
      data-open={showing}
      // What this page knows about the citywide index, in one attribute: the
      // rows are pixels and the difference between "still arriving" and "this
      // build ships none" is not visible in them.
      data-index-status={searchIndexStatus}
    >
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
          // The popup itself, not the list inside it: with no hits the popup
          // is the honesty note, and `aria-expanded="true"` pointing at an id
          // nothing renders would be a dangling reference.
          aria-controls={showing ? "search-drop" : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 && showing ? `search-row-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
            // The last pick's outcome belonged to the last query.
            setNote(null);
            if (event.target.value.trim() !== "") ask();
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>

      {showing ? (
        <div className="search-drop lg deep" id="search-drop">
          {rows.length > 0 ? (
            <ul
              className="search-list"
              data-testid="search-results"
              // `data-count`/`data-total` stay what they have always been: the
              // loaded features, which are the only rows that are places this
              // map is holding. The citywide and category rows are counted
              // separately rather than folded in, because folding them would
              // make one number mean three different promises.
              data-count={answer.hits.length}
              data-total={answer.total}
              data-index-count={citywide.hits.length}
              data-index-total={citywide.total}
              data-category-count={kinds.length}
              role="listbox"
              aria-label="Search results"
            >
              {rows.map((row, index) => {
                const on = index === activeIndex;
                const loading = pending === row.key;
                // The row is picked on mousedown-then-click, so the default
                // mousedown (which blurs the input) is refused: without it
                // the blur closes the dropdown before the click lands on it.
                const hold = (event: { preventDefault: () => void }) => event.preventDefault();

                if (row.kind === "loaded") {
                  const hit = row.hit;
                  return (
                    <li
                      key={row.key}
                      id={`search-row-${index}`}
                      className={`search-row${on ? " on" : ""}`}
                      data-testid="search-result"
                      data-feature-id={hit.id}
                      data-in-view={hit.inView}
                      role="option"
                      aria-selected={on}
                      onMouseDown={hold}
                      onClick={() => choose(row)}
                    >
                      <span aria-hidden className="sr-dot" style={{ background: hit.swatch }} />
                      <span className="sr-main">
                        <span className="sr-name">{hit.name}</span>
                        {/* The second name, when the data carries one that is
                            not the headline: the T-96 pattern, secondary by
                            size and colour, never a replacement. */}
                        {hit.nameEn ? <span className="sr-name-en">{hit.nameEn}</span> : null}
                      </span>
                      <span className="sr-what">{hit.what}</span>
                      <span className="sr-d" data-testid="search-distance">
                        {formatDistance(hit.distanceM)}
                      </span>
                    </li>
                  );
                }

                if (row.kind === "index") {
                  const hit = row.hit;
                  // What else this row is known by — the English name when it
                  // has one, otherwise the address, which is usually the field
                  // that matched. One line, because a suggestion taller than a
                  // result reads as the more important of the two.
                  const second = hit.nameEn ?? hit.address;
                  return (
                    <li
                      key={row.key}
                      id={`search-row-${index}`}
                      className={`search-row idx${on ? " on" : ""}`}
                      data-testid="search-index-result"
                      data-feature-id={hit.id}
                      data-category={hit.category}
                      data-in-view={hit.inView}
                      data-loading={loading || undefined}
                      role="option"
                      aria-selected={on}
                      onMouseDown={hold}
                      onClick={() => choose(row)}
                    >
                      {/* Hollow, because this place is not on the map: the
                          filled dot above means "the store is holding this". */}
                      <span aria-hidden className="sr-dot hollow" />
                      <span className="sr-main">
                        <span className="sr-name">{hit.name}</span>
                        {second ? <span className="sr-name-en">{second}</span> : null}
                      </span>
                      <span className="sr-what">{hit.what}</span>
                      <span className="sr-load" data-testid="search-loads-on-pick">
                        {loading ? "loading…" : "loads on pick"}
                      </span>
                      <span className="sr-d" data-testid="search-distance">
                        {formatDistance(hit.distanceM)}
                      </span>
                    </li>
                  );
                }

                const kind = row.row;
                return (
                  <li
                    key={row.key}
                    id={`search-row-${index}`}
                    className={`search-row cat${on ? " on" : ""}`}
                    data-testid="search-category-result"
                    data-category={kind.category}
                    data-loading={loading || undefined}
                    role="option"
                    aria-selected={on}
                    onMouseDown={hold}
                    onClick={() => choose(row)}
                  >
                    {/* Rose: painting a category is a human asking to look
                        around, the same grammar the browsed beads are drawn in. */}
                    <span aria-hidden className="sr-dot rose" />
                    <span className="sr-main">
                      <span className="sr-name">Browse {kind.label}</span>
                      <span className="sr-name-en">{kind.zh}</span>
                    </span>
                    <span className="sr-what">{loading ? "loading…" : "on the map"}</span>
                    <span className="sr-d" data-testid="search-category-count">
                      {kind.count === null ? "…" : trayCount(kind.count)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            /* Nothing matched anywhere — and the honest reason why. "No
               results" over a map holding 18 unfetched categories would be the
               exact lie the tools refuse to tell ("no cafes here" vs "the cafe
               file was never fetched"), and with the citywide index in hand the
               box can finally say something stronger. Five states, five
               sentences: `searchEmptyNote`. */
            <p className="search-note" data-testid="search-empty">
              {searchEmptyNote(searchIndexStatus, answer.unfetchedCategories)}
            </p>
          )}

          {/* What a pick did that no other surface will report. Never a modal
              and never a toast that steals focus: one line under the rows the
              person is still looking at, gone on the next keystroke. */}
          {note ? (
            <p className="search-note" data-testid="search-pick-note" data-kind={note.kind}>
              {note.kind === "failed"
                ? `${TIER2_PLURAL[note.category]} could not load — the file did not arrive. Try again.`
                : note.kind === "stale"
                  ? `${TIER2_PLURAL[note.category]} loaded, but that place was not in the file — this map's search index is out of date.`
                  : `${TIER2_PLURAL[note.category]} came off the map — ${BROWSE_MAX} kinds of place at a time.`}
            </p>
          ) : null}

          {answer.overflow > 0 ? (
            <p className="search-note" data-testid="search-overflow">
              {answer.overflow} more — zoom in or refine
            </p>
          ) : null}
          {citywide.overflow > 0 ? (
            <p className="search-note" data-testid="search-index-overflow">
              {citywide.overflow} more elsewhere in Taipei, not loaded yet
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
