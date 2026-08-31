/**
 * T-97 -- `get_place_details`: the 14th imperative tool, end to end.
 *
 * `src/lib/map-tools/place-details.test.ts` already proves the whole contract
 * against an in-memory store: per-field omission, the drawing/annotation/
 * unknown-id refusals, the double-category answer, the honest `wheelchair`
 * echo. What this file adds is the part that suite cannot see -- a real page,
 * calls through `document.modelContext` the way a WebMCP client makes them,
 * and the project's own law made testable: **whatever the agent can read
 * through a tool, the human can see on the page** (docs/TASKS.md, "The point
 * of this project"). So every field-presence assertion here has two halves --
 * the tool's JSON, and the same value on the card a tap opens -- not just one.
 *
 * The hotel category is the fixture throughout: it is the one T-97 dataset
 * where a real record carries every one of the five most common enrichment
 * fields at once (address, phone, website, wheelchair, stars -- see
 * `findClickableHotel` below), so "known-rich" and "sparse" are both real,
 * shipped OpenStreetMap records rather than invented fixtures -- consistent
 * with this suite's own convention of reading true counts from the data
 * instead of hard-coding them (tier2.spec.ts).
 *
 * The two card-parity tests below force MapLibre to actually place hundreds
 * of real symbols and run its collision pass continuously (`mockMinimalBasemap`).
 * A QA finding of this task: several concurrent copies of *these same two
 * tests* (`--repeat-each=3`+ against this file alone, on an 11-core box) once
 * starved a bare `map.once("idle", ...)` for 30s+ and once saw a `browse()`
 * promise garbage-collected mid-flight before its resolution reached Node --
 * this suite's own pages competing for the same GPU/CPU, not a defect in the
 * tool or the card. `findClickableHotel` and `browseHotels` below bound every
 * such wait rather than trusting it to resolve eventually; with that in place
 * this file holds at `--repeat-each=5` under this box's own default workers
 * (see the report for the exact numbers) as well as in a single pass.
 */
import type { Page } from "@playwright/test";
import { BEAD_LAYER_IDS } from "@/components/bead-style";
import { TIER2_TEXT_FIELDS } from "@/lib/store/tier2";
import { callTool } from "./mcp";
import { expect, mockExternalHost, test } from "./fixtures";
import { waitForFeatures, waitForLiveMap, waitForStoreHandle, waitForTools } from "./helpers";

const CENTER = { lng: 121.5175, lat: 25.0478 };

// ------------------------------------------------------------- tapping a POI
// Opening the "On the map" card for a real point-of-interest needs a click
// MapLibre itself resolves to a feature, and every one of MapCanvas's data
// layers and click handlers is added inside `map.on("load", ...)` -- which
// never fires under this suite's default network isolation, because the real
// basemap style lives at a blocked host (see fixtures.ts, tier2-live.spec.ts's
// own doc comment on exactly this). A minimal-but-valid style document (no
// sources, no layers of its own) is enough for MapLibre to fire `load` and
// for this page to add its own layers on top of it, so this mocks the CDN
// itself rather than the routing service `mockExternalHost` already had a
// precedent for -- same escape hatch, same leak-check guarantee
// (`blockedRequests`), a different host.
const BASEMAP_HOST = "tiles.openfreemap.org";

async function mockMinimalBasemap(page: Page, mockedExternalHosts: Set<string>): Promise<void> {
  mockExternalHost(mockedExternalHosts, BASEMAP_HOST);
  await page.route(`**/${BASEMAP_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    }),
  );
}

async function goReadyForTaps(page: Page): Promise<void> {
  await page.goto("/");
  await waitForTools(page);
  await waitForFeatures(page);
  await waitForLiveMap(page);
  await waitForStoreHandle(page);
  await expect(page.getByTestId("map-status")).toHaveText("ready", { timeout: 20_000 });
}

/**
 * Loads the hotel category the same way a human's Places tray would.
 *
 * Fires `browse()` without awaiting its own returned promise, then polls the
 * store instead: awaiting the call itself round-trips through the page for as
 * long as fetching and painting the whole category takes, and under heavy
 * contention that promise was once seen garbage-collected mid-flight (a QA
 * finding of this task) before its resolution made it back to Node. Polling
 * the effect this call has on the store sidesteps that -- the call either
 * lands (features appear) or the poll times out loudly, never silently.
 */
async function browseHotels(page: Page): Promise<void> {
  await page.evaluate(() => {
    void window.__glassmapBrowse!.getState().browse("hotel");
  });
  await expect
    .poll(() => page.evaluate(() => window.__glassmapStore!.getState().tier2Features.length), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
}

interface ClickableHotel {
  id: string;
  name: string;
  nameEn?: string;
  x: number;
  y: number;
}

/**
 * Finds a real, shipped hotel record matching `mode` and a screen position
 * that genuinely opens its card -- not merely a coordinate `map.project`
 * turns into pixels, which two records standing close together in dense
 * downtown Taipei can share once MapLibre's own label/icon collision hides
 * one of them (a QA finding of this task: `queryRenderedFeatures` with no
 * point argument still reports a collided-away icon as "on screen"; the point
 * form below is what MapCanvas's own click handler actually queries, so it is
 * the only check honest about what a click will hit). Zooms tight on each
 * candidate's own coordinate in turn until one resolves, so this never depends
 * on which records happen to be isolated in the shipped extract.
 */
async function findClickableHotel(page: Page, mode: "rich" | "sparse"): Promise<ClickableHotel> {
  const candidates = await page.evaluate((mode) => {
    const hotels = window.__glassmapStore!
      .getState()
      .tier2Features.filter((f) => f.properties.category === "hotel");
    const isRich = (p: (typeof hotels)[number]["properties"]) =>
      Boolean(p.nameEn && p.address && p.phone && p.website && p.wheelchair && p.stars);
    const isSparse = (p: (typeof hotels)[number]["properties"]) =>
      !p.nameEn &&
      !p.address &&
      !p.phone &&
      !p.website &&
      !p.wheelchair &&
      !p.stars &&
      !p.cuisine &&
      !p.brand &&
      !p.opening_hours &&
      !p.categories;
    return hotels
      .filter((f) => f.geometry.type === "Point" && (mode === "rich" ? isRich(f.properties) : isSparse(f.properties)))
      .map((f) => ({
        id: f.properties.id,
        name: f.properties.name,
        nameEn: f.properties.nameEn,
        coordinate: f.geometry.type === "Point" ? (f.geometry.coordinates as [number, number]) : [0, 0],
      }));
  }, mode);

  for (const candidate of candidates) {
    const view = await callTool(page, "set_map_view", {
      center: { lng: candidate.coordinate[0], lat: candidate.coordinate[1] },
      zoom: 20,
    });
    if (view.error) throw new Error(`set_map_view failed while locating a ${mode} hotel: ${view.error}`);
    // Bounded rather than a bare `map.once("idle", ...)`: under heavy
    // contention (several of this suite's own live-map pages at once) idle
    // can take longer than is worth waiting for one candidate, and the loop
    // below is built to try the next one rather than hang the whole test on
    // it (a QA finding of this task -- see the file's own top-of-file note).
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const map = window.__glassmapMap!;
          const timer = setTimeout(resolve, 5000);
          map.once("idle", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    );
    const point = await page.evaluate(
      ({ id, layers }) => {
        const map = window.__glassmapMap!;
        const at = map
          .queryRenderedFeatures({ layers })
          .find((f) => (f.properties as { id?: string }).id === id && f.geometry.type === "Point");
        if (!at || at.geometry.type !== "Point") return null;
        const projected = map.project(at.geometry.coordinates as [number, number]);
        // The strict check: is this record hit-testable at the exact pixel it
        // projects to, the same query MapCanvas's own click handler runs?
        const hit = map.queryRenderedFeatures([projected.x, projected.y], { layers });
        return hit.some((f) => (f.properties as { id?: string }).id === id)
          ? { x: projected.x, y: projected.y }
          : null;
      },
      { id: candidate.id, layers: [...BEAD_LAYER_IDS] },
    );
    if (point) {
      return { id: candidate.id, name: candidate.name, nameEn: candidate.nameEn, x: point.x, y: point.y };
    }
  }
  throw new Error(
    `no ${mode} hotel in the shipped extract was clickable at zoom 20 (all ${candidates.length} candidates collided with a neighbour) -- see findClickableHotel`,
  );
}

async function openCardFor(page: Page, target: ClickableHotel): Promise<void> {
  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId("on-the-map-card")).toBeVisible();
  await expect(page.getByTestId("on-the-map-card")).toHaveAttribute("data-card-id", target.id);
}

test.describe("get_place_details (T-97)", () => {
  // The candidate walk can spend ~18s of the default 30s budget on an idle
  // machine (7 rich hotels, each a set_map_view + bounded idle wait); a
  // loaded CI runner needs the headroom (T-97 final review, SF2).
  test.setTimeout(60_000);
  test("known-rich place: the tool's answer and the tapped card agree field for field, and its website is safe to open", async ({
    page,
    mockedExternalHosts,
  }) => {
    await mockMinimalBasemap(page, mockedExternalHosts);
    await goReadyForTaps(page);
    await browseHotels(page);

    const target = await findClickableHotel(page, "rich");
    await openCardFor(page, target);

    const details = await callTool(page, "get_place_details", { id: target.id });
    expect(details.error).toBeUndefined();
    expect(details.id).toBe(target.id);
    expect(details.name).toBe(target.name);
    expect(details.name_en).toBe(target.nameEn);
    // `findClickableHotel`'s own filter -- this is the record it picked
    // because every one of these is present, so the tool answering without
    // one would be the actual regression this test exists to catch.
    for (const field of ["address", "phone", "website", "wheelchair", "stars"] as const) {
      expect(typeof details[field], `${field} should be a real OSM value`).toBe("string");
    }

    // The parity law, made testable: `title=` on the card's own row is the
    // full, untruncated OSM value (feature-details.ts's `DetailRow.full`),
    // never the (possibly folded) text a narrow card shows -- so it is the
    // right half of the card to diff against the tool's own answer.
    await expect(page.getByTestId("otm-name")).toHaveText(details.name!);
    await expect(page.getByTestId("otm-name-en")).toHaveText(details.name_en!);
    for (const field of TIER2_TEXT_FIELDS) {
      const row = page.getByTestId(`otm-detail-${field}`);
      if (field in details) {
        await expect(row, `${field} is in the tool's answer but missing from the card`).toHaveAttribute(
          "title",
          details[field] as string,
        );
      } else {
        await expect(row, `${field} is on the card but the tool's answer omits it`).toHaveCount(0);
      }
    }

    // The one row that is also a link. Visible text stays the clipped OSM
    // value; the href is the whole of it, and it must be safe to open next to
    // a live map an agent may still be working on: a new tab, never a
    // same-tab navigation, and only ever http(s) (feature-details.ts's
    // `linkHref` allow-list -- see also its own unit test for the scheme
    // block-list this only re-confirms end to end).
    const link = page.getByTestId("otm-detail-link");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^https?:\/\//);
    // The normalised form of the tool's own raw value, not a second opinion:
    // both surfaces must be quoting the same OSM tag.
    expect(href).toBe(new URL(details.website!).href);
  });

  // The candidate walk can spend ~18s of the default 30s budget on an idle
  // machine (7 rich hotels, each a set_map_view + bounded idle wait); a
  // loaded CI runner needs the headroom (T-97 final review, SF2).
  test.setTimeout(60_000);
  test("sparse place: fields OpenStreetMap does not have are absent from the answer and absent as rows on the card", async ({
    page,
    mockedExternalHosts,
  }) => {
    await mockMinimalBasemap(page, mockedExternalHosts);
    await goReadyForTaps(page);
    await browseHotels(page);

    const target = await findClickableHotel(page, "sparse");
    await openCardFor(page, target);

    const details = await callTool(page, "get_place_details", { id: target.id });
    expect(details.error).toBeUndefined();
    expect(details.id).toBe(target.id);
    expect(details.name).toBe(target.name);
    expect(details.name_en).toBeUndefined();
    for (const field of TIER2_TEXT_FIELDS) {
      expect(field in details, `${field} should be absent, not null or empty`).toBe(false);
    }
    // Never a null or an empty string standing in for absent -- the same rule
    // place-details.test.ts holds the tool to, checked here on a real record.
    expect(JSON.stringify(details)).not.toMatch(/null|""/);

    // The DOM half of the same rule: the whole details section -- and the
    // second name line -- disappear rather than rendering with nothing in
    // them (OnTheMapCard.tsx renders `<dl>` only when `details.length > 0`).
    await expect(page.getByTestId("otm-name-en")).toHaveCount(0);
    await expect(page.getByTestId("otm-details")).toHaveCount(0);
  });
});

test.describe("get_place_details refusals (T-97)", () => {
  test("an unknown id is sent back to find_features, not answered as empty", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const out = await callTool(page, "get_place_details", { id: "osm:node:not-a-real-e2e-id" });
    expect(out.error).toContain("osm:node:not-a-real-e2e-id");
    expect(out.error).toMatch(/find_features/);
    expect(out.id).toBeUndefined();
  });

  test("a drawn shape's id is refused toward measure and get_map_state, not answered as an unknown feature", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const drawn = await callTool(page, "draw_shape", { type: "circle", center: CENTER, radius_m: 300 });
    expect(drawn.error).toBeUndefined();
    const drawingId = drawn.drawing_id as string;

    const out = await callTool(page, "get_place_details", { id: drawingId });
    expect(out.error).toMatch(/measure/);
    expect(out.error).toMatch(/get_map_state/);
    expect(out.error).toContain(drawingId);
    expect(out.name).toBeUndefined();
  });

  test("a pinned note's id is refused the same way -- it is not a place either", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    const pinned = await callTool(page, "annotate", { at: "Daan Station", note: "e2e refusal probe" });
    expect(pinned.error).toBeUndefined();
    const annotationId = pinned.annotation_id as string;

    const out = await callTool(page, "get_place_details", { id: annotationId });
    expect(out.error).toMatch(/get_map_state/);
    expect(out.error).toContain(annotationId);
    expect(out.name).toBeUndefined();
  });
});

// ------------------------------------------------------------------------ fx
// Reimplements remove-from-map.spec.ts's own browser-clock MutationObserver
// idiom (duplicated from fx.spec.ts's private version there, for the same
// reason recorded in both: a Node-side poll of `data-fx-*` has its own IPC
// round trip inside the ~900ms window this file measures, which is exactly
// the race those files' own comments record having produced a false failure
// before).
interface FxClockState {
  startedAt?: number;
  startedPlaying?: string;
  nodeSeenAtStart?: boolean;
  clearedAt?: number;
  viewportChildren?: number;
  overlayChildren?: number;
}

interface FxCycle {
  lifetimeMs: number | null;
  startedPlaying: string | null;
  nodeSeenAtStart: boolean;
  viewportChildren: number | null;
  overlayChildren: number | null;
}

async function armFxClock(page: Page, effectName: string): Promise<void> {
  await page.evaluate((effectName) => {
    const w = window as unknown as { __placeFxClock?: FxClockState; __placeFxObserver?: MutationObserver };
    w.__placeFxObserver?.disconnect();
    w.__placeFxClock = {};
    const viewport = document.querySelector<HTMLElement>('[data-testid="fx-viewport"]');
    const overlay = document.querySelector<HTMLElement>('[data-testid="fx-overlay"]');
    if (!viewport) return;
    const observer = new MutationObserver(() => {
      const clock = w.__placeFxClock!;
      const count = viewport.dataset.fxCount ?? "0";
      if (count !== "0" && clock.startedAt === undefined) {
        clock.startedAt = performance.now();
        clock.startedPlaying = viewport.dataset.fxPlaying ?? "";
        clock.nodeSeenAtStart =
          document.querySelectorAll(`[data-testid="fx-effect"][data-fx-name="${effectName}"]`).length > 0;
      } else if (count === "0" && clock.startedAt !== undefined && clock.clearedAt === undefined) {
        clock.clearedAt = performance.now();
        clock.viewportChildren = viewport.childElementCount;
        clock.overlayChildren = overlay?.childElementCount ?? -1;
      }
    });
    observer.observe(viewport, { attributes: true, attributeFilter: ["data-fx-count"] });
    w.__placeFxObserver = observer;
  }, effectName);
}

async function waitForFxCycle(page: Page, timeoutMs: number): Promise<FxCycle> {
  return page.evaluate((timeoutMs) => {
    return new Promise<FxCycle>((resolve) => {
      const w = window as unknown as { __placeFxClock?: FxClockState };
      const deadline = performance.now() + timeoutMs;
      const check = () => {
        const clock = w.__placeFxClock;
        if (clock?.startedAt !== undefined && clock.clearedAt !== undefined) {
          resolve({
            lifetimeMs: clock.clearedAt - clock.startedAt,
            startedPlaying: clock.startedPlaying ?? null,
            nodeSeenAtStart: clock.nodeSeenAtStart ?? false,
            viewportChildren: clock.viewportChildren ?? null,
            overlayChildren: clock.overlayChildren ?? null,
          });
        } else if (performance.now() >= deadline) {
          resolve({
            lifetimeMs: null,
            startedPlaying: null,
            nodeSeenAtStart: false,
            viewportChildren: null,
            overlayChildren: null,
          });
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }, timeoutMs);
}

/** Any loaded hotel's id -- the fx test does not care which fields it carries. */
async function anyHotelId(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      window.__glassmapStore!
        .getState()
        .tier2Features.find((f) => f.properties.category === "hotel")!.properties.id,
  );
}

test.describe("get_place_details FX (T-97)", () => {
  test("reading a place glints its mark on the map and clears within 2s, with zero residue", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);
    await waitForStoreHandle(page);
    await browseHotels(page);

    await armFxClock(page, "get_place_details");
    const out = await callTool(page, "get_place_details", { id: await anyHotelId(page) });
    expect(out.error).toBeUndefined();
    const cycle = await waitForFxCycle(page, 2000);

    expect(cycle.startedPlaying, JSON.stringify(cycle)).toBe("get_place_details");
    // The real glint anchored on the place's own mark (`{kind: "place", at}`),
    // not the geometry-less fallback an id with no anchor would degrade to
    // (plan.ts's own comment on this branch).
    expect(cycle.nodeSeenAtStart).toBe(true);
    expect(cycle.lifetimeMs, JSON.stringify(cycle)).not.toBeNull();
    expect(cycle.lifetimeMs).toBeLessThanOrEqual(2000);
    expect(cycle.viewportChildren).toBe(0);
    expect(cycle.overlayChildren).toBe(0);
    await expect(page.getByTestId("fx-effect")).toHaveCount(0);
  });

  test("?fx=off: reading a place never spawns an fx-effect node", async ({ page }) => {
    await page.goto("/?fx=off");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForLiveMap(page);
    await waitForStoreHandle(page);
    await expect(page.locator("body")).toHaveAttribute("data-fx", "off");
    await browseHotels(page);

    const out = await callTool(page, "get_place_details", { id: await anyHotelId(page) });
    expect(out.error).toBeUndefined();

    const viewport = page.getByTestId("fx-viewport");
    await expect(viewport).toHaveAttribute("data-fx-count", "0");
    expect(await viewport.evaluate((el) => el.childElementCount)).toBe(0);
    await expect(page.getByTestId("fx-effect")).toHaveCount(0);
  });
});

// -------------------------------------------------------------- T-96 handoff
// The bilingual-naming pattern T-96 gave the tap card also lives on the
// inspector's own "Selected" rows (Inspector.tsx), and this was never
// exercised in the default suite (only real-POI screenshot probes, run by
// hand -- docs/TASKS.md's T-96 entry). Needs no click and no basemap: a
// selection is store state Inspector reads directly.
test.describe("sidebar bilingual naming (T-96 handoff)", () => {
  test("a selected place's English name is in its own row, scoped by feature id", async ({ page }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);
    await browseHotels(page);

    const picks = await page.evaluate(() => {
      const hotels = window.__glassmapStore!
        .getState()
        .tier2Features.filter((f) => f.properties.category === "hotel");
      // Two DIFFERENT bilingual records, not one -- the scenario the
      // strict-mode point below is actually about.
      const bilingual = hotels
        .filter((f) => f.properties.nameEn)
        .slice(0, 2)
        .map((f) => ({ id: f.properties.id, nameEn: f.properties.nameEn! }));
      const monolingual = hotels.find((f) => !f.properties.nameEn);
      return { bilingual, monolingual: monolingual ? monolingual.properties.id : null };
    });
    if (picks.bilingual.length < 2 || !picks.monolingual) {
      throw new Error("need at least two shipped hotels with an English name and one without");
    }
    const [first, second] = picks.bilingual as [{ id: string; nameEn: string }, { id: string; nameEn: string }];

    const selected = await callTool(page, "select_features", {
      ids: [first.id, second.id, picks.monolingual],
    });
    expect(selected.error).toBeUndefined();

    // The strict-mode point this handoff is about: `sidebar-name-en` repeats
    // per bilingual row, so with two bilingual places selected the testid now
    // matches two elements at once -- a bare `page.getByTestId("sidebar-name-en")`
    // would reject any single-element action or assertion against it
    // (Playwright's strict mode). Every assertion below is scoped by the
    // row's own `data-feature-id` instead, which is what actually
    // disambiguates them.
    await expect(page.getByTestId("sidebar-name-en")).toHaveCount(2);

    const firstRow = page.locator(`li[data-feature-id="${first.id}"]`);
    await expect(firstRow.getByTestId("sidebar-name-en")).toHaveText(first.nameEn);

    const secondRow = page.locator(`li[data-feature-id="${second.id}"]`);
    await expect(secondRow.getByTestId("sidebar-name-en")).toHaveText(second.nameEn);

    const monolingualRow = page.locator(`li[data-feature-id="${picks.monolingual}"]`);
    await expect(monolingualRow.getByTestId("sidebar-name-en")).toHaveCount(0);
  });
});
