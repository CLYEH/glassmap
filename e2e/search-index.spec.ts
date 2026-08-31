/**
 * The citywide search box (T-100) -- "almost any input finds something", end
 * to end.
 *
 * Three earlier stages already have unit coverage over synthetic fixtures:
 *  - `search-index-model.test.ts` / `search-vocabulary.test.ts` -- the
 *    matcher and ranker, over hand-built rows;
 *  - `search-disclosure.test.ts` -- `find_features`' `unloaded_matches`,
 *    over fixture tier-2 files.
 * None of those can see the one thing that actually decides whether the
 * owner's bar is met: the real, shipped `public/data/tier2/search-index.json`
 * (31,057 rows) and the real category files, driven through the DOM the way
 * a person types and through `document.modelContext` the way an agent calls
 * a tool. This suite runs under the default network isolation
 * (`fixtures.ts` blocks every non-localhost host); every file it touches
 * lives under `/data/tier2/`, same-origin to the `next dev` server, exactly
 * the guarantee `tier2.spec.ts` already relies on.
 *
 * Numbers below are measured against the shipped extract rather than derived
 * at runtime, on purpose -- like `FEATURE_COUNT` in `helpers.ts`, they pin
 * this spec to the real data so a regeneration that quietly changes what a
 * query finds fails a test instead of nothing. Since T-102, `find_features`'
 * `unloaded_matches` and the human box's own `searchIndexEntries` read the
 * same five columns through the same predicate (`matchesQuery`,
 * `map-tools/query.ts`) -- one count, not two that happen to coincide.
 * `STARBUCKS_CITYWIDE_CAFES` (151) is every index row whose name, English
 * name, brand, cuisine or address contains "starbucks" -- in this data all of
 * them are matched by name/nameEn alone and all are tagged `cafe`, so
 * widening the predicate to five fields did not add a row; that is a fact
 * about what OSM happens to call these places, not a coincidence the
 * predicate arranges. (The Chinese name reaches one row more -- 152 rows
 * carry 星巴克 or "starbucks" between them -- which is why the data README
 * words that count as a union rather than as one query's answer.)
 *
 * Item 6's second case pins the other half of T-102: a cuisine tag value
 * ("coffee_shop") that no row is *named*, which the pre-T-102 tool discovered
 * nothing about and now discloses in full, by category, with the >= floor
 * that reconciliation is allowed to be.
 */
import type { Page } from "@playwright/test";
import { SEARCH_INDEX_LIMIT } from "@/components/search-index-model";
import { SEARCH_ZOOM } from "@/components/search-model";
import { expect, test } from "./fixtures";
import { waitForFeatures, waitForStoreHandle, waitForTools } from "./helpers";
import { callTool } from "./mcp";

/** See the header: every index row whose name/nameEn contains "starbucks", all `cafe`. */
const STARBUCKS_CITYWIDE_CAFES = 151;

/**
 * The owner's acceptance bar (T-100): every one of these must turn up at
 * least one row -- loaded, citywide index, or "browse this kind" -- once the
 * citywide index has answered. Mixed on purpose, so no single code path can
 * make the whole battery pass by accident: a brand name, a Chinese and an
 * English generic word for the same category, a cuisine tag value, a street
 * name, a bare chain number, a Chinese category word, and two place names
 * the *bundled* (always-loaded) data already answers without any index at
 * all -- the one pair in this list an index outage could never break.
 */
const BATTERY = [
  "starbucks",
  "路易莎",
  "咖啡",
  "coffee",
  "拉麵",
  "藥局",
  "pharmacy",
  "基河路",
  "7-11",
  "便利商店",
  "大安森林公園",
  "台北車站",
];

/** Any of the three kinds of dropdown row -- see `SearchBox.tsx`'s own header. */
const ANY_ROW =
  '[data-testid="search-result"], [data-testid="search-index-result"], [data-testid="search-category-result"]';

function searchBox(page: Page) {
  return page.getByTestId("search-box");
}

function searchInput(page: Page) {
  return page.getByTestId("search-input");
}

/** One simulated keystroke: `fill` sets the whole value and fires one `input` event. */
async function typeQuery(page: Page, query: string): Promise<void> {
  await searchInput(page).fill(query);
}

/** Waits for the citywide index to answer (fetched and parsed), however long that takes. */
async function waitForIndexReady(page: Page): Promise<void> {
  await expect(searchBox(page)).toHaveAttribute("data-index-status", "ready", { timeout: 10_000 });
}

/**
 * The store fields item 3 and item 4 need to prove the no-wake law: read
 * directly, never through a tool call, because calling *any* tool -- even a
 * read-only one -- records an activity row (`map-tools/activity.ts`) and
 * would make the very thing under test untrue.
 */
interface StoreSnapshot {
  activity: unknown[];
  selection: string[];
  selectionSources: Record<string, string>;
  tier2Loaded: string[];
  view: { center: [number, number]; zoom: number };
}

async function storeSnapshot(page: Page): Promise<StoreSnapshot> {
  return page.evaluate(() => {
    const s = window.__glassmapStore!.getState();
    return {
      activity: s.activity,
      selection: s.selection,
      selectionSources: s.selectionSources,
      tier2Loaded: s.tier2Loaded,
      view: { center: s.view.center, zoom: s.view.zoom },
    };
  });
}

async function browseCategories(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__glassmapBrowse!.getState().categories);
}

/** The citywide index's own coordinate for one id, at its native 5 decimals. */
async function indexEntryCenter(
  page: Page,
  id: string,
): Promise<{ lng: number; lat: number } | null> {
  return page.evaluate((featureId) => {
    const idx = window.__glassmapStore!.getState().searchIndex;
    const entry = idx?.find((e) => e.id === featureId) ?? null;
    return entry ? { lng: entry.lng, lat: entry.lat } : null;
  }, id);
}

test.describe("1. the acceptance gate -- every query in the owner's list finds something (T-100)", () => {
  test("a fresh page answers all twelve once the citywide index is ready", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    // The first keystroke starts the index fetch; a query typed before it
    // lands is a "still loading" miss, not the defect this battery checks
    // for -- so every term below is asked only once the index has answered.
    await typeQuery(page, BATTERY[0]!);
    await waitForIndexReady(page);

    for (const term of BATTERY) {
      await test.step(`"${term}"`, async () => {
        await typeQuery(page, term);
        await expect(
          page.locator(ANY_ROW).first(),
          `"${term}" should have produced at least one row (loaded, citywide index, or "browse this kind")`,
        ).toBeVisible();
      });
    }
  });
});

test.describe("2. laziness -- the citywide index is fetched on demand, never at load (T-100)", () => {
  test("zero /data/tier2/** requests before the first keystroke; the first keystroke fetches search-index.json", async ({
    page,
  }) => {
    const tier2Requests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/data/tier2/")) tier2Requests.push(url);
    });

    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    expect(tier2Requests, "no /data/tier2/** request should fire before the box is used").toEqual(
      [],
    );

    await typeQuery(page, "starbucks");
    await expect
      .poll(() => tier2Requests.some((url) => url.endsWith("/data/tier2/search-index.json")))
      .toBe(true);
  });
});

test.describe("3. the starbucks pick, end to end -- loads without painting, wakes nothing (T-100)", () => {
  test("picking a citywide row loads its category, selects it as the human's, and never touches the agent chrome", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    await typeQuery(page, "starbucks");
    await waitForIndexReady(page);

    const row = page.locator('[data-testid="search-index-result"]').first();
    await expect(row).toBeVisible();
    const id = await row.getAttribute("data-feature-id");
    const category = await row.getAttribute("data-category");
    expect(id).toBeTruthy();
    // Every "starbucks" index row is tagged cafe (see the header) -- pinned
    // here as a real assertion, not an assumption the rest of the test relies
    // on silently.
    expect(category).toBe("cafe");

    await row.click();

    // The load, not the click: `restoreCategories` is a real network round
    // trip to cafe.geojson.
    await page.waitForFunction(
      (cat) => (window.__glassmapStore!.getState().tier2Loaded as string[]).includes(cat),
      category!,
    );

    const snapshot = await storeSnapshot(page);
    const center = await indexEntryCenter(page, id!);

    // Loads without painting: the budget (`BROWSE_MAX`) is not spent on a
    // single pick.
    expect(await browseCategories(page)).toEqual([]);

    // Selected as the human's, appended (never replacing) -- the same write
    // a tap on the map makes.
    expect(snapshot.selection).toContain(id);
    expect(snapshot.selectionSources[id!]).toBe("user");

    // Camera eased to the row's own coordinate, never zoomed below SEARCH_ZOOM.
    expect(center).not.toBeNull();
    expect(snapshot.view.center[0]).toBeCloseTo(center!.lng, 4);
    expect(snapshot.view.center[1]).toBeCloseTo(center!.lat, 4);
    expect(snapshot.view.zoom).toBe(SEARCH_ZOOM);

    // The no-wake law through the whole citywide path: no activity row, and
    // the chrome never left idle.
    expect(snapshot.activity.length).toBe(0);
    expect(await page.evaluate(() => document.body.dataset.awaken)).toBe("idle");
  });
});

test.describe("4. a category row pick paints, and still wakes nothing (T-100)", () => {
  test("'藥局' offers 'Browse Pharmacies'; picking it paints the category and shows the active chip", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    await typeQuery(page, "藥局");
    const categoryRow = page.locator('[data-testid="search-category-result"][data-category="pharmacy"]');
    await expect(categoryRow).toBeVisible();
    await categoryRow.click();

    await page.waitForFunction(() =>
      (window.__glassmapBrowse!.getState().categories as string[]).includes("pharmacy"),
    );

    await expect(
      page.locator('[data-testid="places-active-item"][data-category="pharmacy"]'),
    ).toBeVisible();

    const snapshot = await storeSnapshot(page);
    expect(snapshot.activity.length).toBe(0);
  });
});

test.describe("5. failure honesty -- a moment never gets dressed up as a fact (T-100)", () => {
  test("an index that never arrives degrades without hiding the loaded (bundled) half of the box", async ({
    page,
  }) => {
    await page.route("**/data/tier2/search-index.json", (route) => route.abort());

    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    await typeQuery(page, "zzzz-no-such-place");
    await expect(searchBox(page)).toHaveAttribute("data-index-status", "failed");

    // The index failing must not take the loaded half of the box down with
    // it: a bundled MRT station is still findable by name.
    await typeQuery(page, "台北車站");
    await expect(page.locator('[data-testid="search-result"]').first()).toBeVisible();

    // Truly nothing anywhere: the empty note names the real reason, not a
    // generic "no results".
    await typeQuery(page, "zzzz-truly-nothing-matches-this-9137");
    await expect(page.getByTestId("search-empty")).toHaveText(
      "Nothing loaded matches that — the citywide index did not arrive. Keep typing to try again.",
    );
  });

  test("a category file that will not load leaves the pick honestly failed, with nothing half-selected", async ({
    page,
  }) => {
    await page.route("**/data/tier2/cafe.geojson", (route) => route.abort());

    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    await typeQuery(page, "starbucks");
    await waitForIndexReady(page);

    const before = await storeSnapshot(page);
    expect(before.selection).toEqual([]);

    await page.locator('[data-testid="search-index-result"]').first().click();

    await expect(page.getByTestId("search-pick-note")).toHaveAttribute("data-kind", "failed");

    const after = await storeSnapshot(page);
    // Nothing half-selected: the selection is exactly what it was before the
    // pick, and cafe never entered memory.
    expect(after.selection).toEqual(before.selection);
    expect(after.tier2Loaded).not.toContain("cafe");

    // And the note is the ONLY surface that says so. A pick is not a share
    // restore: routing it through `restoreTier2Categories` used to record a
    // `tier2RestoreFailures` entry, which made this page -- opened with no
    // link at all -- render "couldn't load cafe for this link" and hand an
    // agent a broken-link claim, on top of re-declaring cafe in the next link
    // it wrote. `SearchBox` takes the store's plain `loadTier2Category` for
    // exactly this reason.
    await expect(page.getByTestId("share-restore")).toHaveCount(0);
    // Read last, because any tool call records activity: the assertions above
    // are about a page nothing has called a tool on.
    const state = await callTool(page, "get_map_state", {});
    expect(state.error).toBeUndefined();
    expect(state.tier2?.failed ?? []).toEqual([]);
  });

  test("a category file that arrives without the picked place says so, and still selects nothing", async ({
    page,
  }) => {
    // The other half of "never select an id the store cannot resolve", and the
    // half that survives a *successful* load: the citywide index and the
    // category files are generated separately (`scripts/fetch-tier2.mjs
    // --only`), so a deployment can serve an index row for a place its cafe
    // file no longer contains. Selecting that id would highlight nothing, and
    // T-101's inspector would render it as an inert "not loaded" row with no
    // way out -- honest, and indistinguishable from a bug.
    //
    // Simulated by serving the *real* cafe.geojson with every Starbucks
    // stripped: a valid file, correctly parsed, fully loaded -- so nothing but
    // the guard in `chooseIndex` can produce the outcome asserted below.
    let stripped = 0;
    await page.route("**/data/tier2/cafe.geojson", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        features: { properties: { name?: string; nameEn?: string } }[];
      };
      const before = body.features.length;
      body.features = body.features.filter(({ properties }) => {
        const written = `${properties.name ?? ""} ${properties.nameEn ?? ""}`.toLowerCase();
        return !written.includes("starbucks") && !written.includes("星巴克");
      });
      stripped = before - body.features.length;
      // `response` carries the real status and headers; only the body changes.
      await route.fulfill({ response, body: JSON.stringify(body) });
    });

    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    await typeQuery(page, "starbucks");
    await waitForIndexReady(page);

    const before = await storeSnapshot(page);
    const row = page.locator('[data-testid="search-index-result"]').first();
    await expect(row).toBeVisible();
    const id = await row.getAttribute("data-feature-id");
    expect(await row.getAttribute("data-category")).toBe("cafe");

    await row.click();

    await expect(page.getByTestId("search-pick-note")).toHaveAttribute("data-kind", "stale");

    const after = await storeSnapshot(page);
    // The load really happened -- this is not the failed path wearing another
    // word. Cafe is in memory, and the picked id is not.
    expect(after.tier2Loaded).toContain("cafe");
    expect(stripped, "the served cafe file must really have lost its Starbucks").toBeGreaterThan(0);
    expect(
      await page.evaluate(
        (featureId) =>
          window
            .__glassmapStore!.getState()
            .tier2Features.some((f) => f.properties.id === featureId),
        id!,
      ),
      "the guard's own premise: the loaded file does not contain the picked id",
    ).toBe(false);

    // Byte-identical selection: not merely "the id is absent" but "nothing
    // moved", which is what keeps the inspector and every share link this page
    // writes free of a row nothing can answer for.
    expect(after.selection).toEqual(before.selection);
    expect(after.selectionSources).toEqual(before.selectionSources);
    expect(after.selection).not.toContain(id);
  });
});

test.describe("6. find_features unloaded_matches -- what a name search could have found (T-100)", () => {
  test("a fresh page discloses the citywide cafe count for 'starbucks', and it disappears once cafe is loaded", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const before = await callTool(page, "find_features", { query: "starbucks" });
    expect(before.error).toBeUndefined();
    // Nothing bundled is called Starbucks: the whole point of this field.
    expect(before.total).toBe(0);
    expect(before.unloaded_matches).toEqual([
      { category: "cafe", count: STARBUCKS_CITYWIDE_CAFES },
    ]);
    expect(before.unloaded_matches_omitted).toBeUndefined();

    // Naming cafe loads it for the whole city -- the agent's own follow-up call.
    const loadCafe = await callTool(page, "find_features", { categories: ["cafe"], limit: 1 });
    expect(loadCafe.error).toBeUndefined();

    const after = await callTool(page, "find_features", { query: "starbucks" });
    expect(after.error).toBeUndefined();
    expect(after.total).toBe(STARBUCKS_CITYWIDE_CAFES);
    // Already searched, already answered above: no longer "unloaded".
    expect(after.unloaded_matches).toBeUndefined();
  });

  test("a cuisine-tag-value query discloses every category it reaches, and the disclosed count is a FLOOR once that category loads", async ({
    page,
  }) => {
    // "coffee_shop" is a cuisine *tag value*, not anybody's name -- until
    // T-102 this was the one case unloaded_matches stayed silent about,
    // because it counted name/nameEn only (`matchesName`). T-102 widened the
    // predicate to all five fields (`matchesQuery`) on both sides at once, so
    // this same query now discloses real numbers: measured against the
    // shipped index (public/data/tier2/search-index.json, 31,057 rows), every
    // row whose name/nameEn/brand/cuisine/address contains "coffee_shop" as a
    // substring, tallied by category -- cafe (631), restaurant (39),
    // fast_food (4), bakery (1), convenience (1). All five fit under
    // UNLOADED_MATCH_LIMIT (6), so nothing is omitted.
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const before = await callTool(page, "find_features", { query: "coffee_shop" });
    expect(before.error).toBeUndefined();
    expect(before.total).toBe(0); // nothing bundled has a cuisine tag at all.
    expect(before.unloaded_matches).toEqual([
      { category: "cafe", count: 631 },
      { category: "restaurant", count: 39 },
      { category: "fast_food", count: 4 },
      { category: "bakery", count: 1 },
      { category: "convenience", count: 1 },
    ]);
    expect(before.unloaded_matches_omitted).toBeUndefined();

    // Naming cafe loads it for the whole city -- the agent's own follow-up
    // call, same as the starbucks case above.
    const loadCafe = await callTool(page, "find_features", { categories: ["cafe"], limit: 1 });
    expect(loadCafe.error).toBeUndefined();

    const after = await callTool(page, "find_features", { query: "coffee_shop" });
    expect(after.error).toBeUndefined();
    // The reconciliation invariant is >=, never ===: `unloadedMatches`' own
    // header names two mechanisms that can only push the disclosed number
    // DOWN from what a later call actually returns, never up --
    //  (1) a row is dropped from the count as soon as ANY of its categories is
    //      in memory, so a feature tagged both cafe and restaurant stops
    //      counting toward either the moment cafe loads, even though it is
    //      still findable;
    //  (2) the index and a category file are generated separately
    //      (public/data/README.md), so a file can hold a name or tag the
    //      index row for the same id never saw.
    // Both are safe in the direction they err -- an agent is never sent after
    // features that the follow-up call cannot produce -- which is exactly
    // what makes a strict === the wrong invariant to pin here: on THIS
    // extract cafe happens to have no coffee_shop row double-tagged with
    // another loaded category, so total lands exactly on the floor (631) --
    // a coincidence of today's data, not a promise this test may assume holds
    // after the next regeneration.
    expect(after.total!).toBeGreaterThanOrEqual(631);
    // Already searched, already answered above: no longer "unloaded" --
    // dropped from the list entirely rather than reported at 0, so an agent
    // scanning unloaded_matches cannot mistake "gone" for "still zero
    // elsewhere".
    expect(after.unloaded_matches).toEqual([
      { category: "restaurant", count: 39 },
      { category: "fast_food", count: 4 },
      { category: "bakery", count: 1 },
      { category: "convenience", count: 1 },
    ]);
  });
});

test.describe("7. overflow honesty -- the cap never hides the true remainder (T-100)", () => {
  test("'starbucks' shows the capped citywide rows and names how many more exist elsewhere in Taipei", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    await typeQuery(page, "starbucks");
    await waitForIndexReady(page);

    await expect(page.locator('[data-testid="search-index-result"]')).toHaveCount(
      SEARCH_INDEX_LIMIT,
    );
    const overflow = STARBUCKS_CITYWIDE_CAFES - SEARCH_INDEX_LIMIT;
    await expect(page.getByTestId("search-index-overflow")).toHaveText(
      `${overflow} more elsewhere in Taipei, not loaded yet`,
    );
  });
});
