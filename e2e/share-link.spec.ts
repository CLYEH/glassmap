/**
 * Share links (T-31) -- end-to-end.
 *
 * `src/lib/map-tools/share.ts` (the codec) and `src/components/share-hash.ts`
 * (the debounced write) already have unit coverage: the wire format, what
 * gets dropped from a hostile link, and `planHashUpdate`'s no-write/too-large
 * guards are all tested in isolation there. This file is the part those
 * tests cannot see: a real `history.replaceState` in a real address bar,
 * driven by `useShareHash.ts`'s effect, read back by `page.goto` into a
 * second browser context the way an actual recipient would open a pasted
 * link.
 *
 * Kept out of this file on purpose: re-deriving codec edge cases already
 * covered by `share.test.ts` / `share-hash.test.ts` would only mirror the
 * implementation (see AGENTS/CONTRIBUTING "a test must be able to fail when
 * business logic changes"). What is here instead: does opening a link
 * actually restore the page, does a valid link's presence leave the address
 * bar alone, does the debounce avoid flooding `history`, and does the one
 * DOM-visible failure mode (the budget freeze) say the right thing and clear
 * itself.
 */
import { callTool } from "./mcp";
import { forceNoWebGL2, waitForFeatures, waitForStoreHandle, waitForTools } from "./helpers";
import { blockExternalNetwork, expect, test } from "./fixtures";
import { decodeShareState } from "@/lib/map-tools/share";
import { DEFAULT_VIEW, type Drawing } from "@/lib/store/map-store";
import { SHARE_TOO_LARGE_MESSAGE, SHARE_WRITE_DEBOUNCE_MS } from "@/components/share-hash";

/**
 * `toBase64Url` in share.ts, reimplemented on the Node side of the test
 * runner (not imported -- the whole point is to build a payload
 * `encodeShareState` itself would refuse, so it cannot go anywhere near the
 * real encoder). Node's own "base64url" transform already produces
 * unpadded, URL-safe output, which is exactly what the codec's hand-rolled
 * version does too (see `share.test.ts`'s `wire()` helper for the same
 * trick).
 */
function wireHash(payload: unknown): string {
  return `v1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

/** A ring of `points` corners around Taipei Main Station, closed. */
function bigRing(points: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (2 * Math.PI * i) / points;
    ring.push([121.5175 + 0.05 * Math.cos(angle), 25.0478 + 0.05 * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

test.describe("share link (T-31)", () => {
  test("round trip: a fresh context opening the link sees the same view, selection, drawings and notes", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    const view = await callTool(page, "set_map_view", {
      center: { lng: 121.5389, lat: 25.0357 },
      zoom: 15.5,
      bearing: 40,
      pitch: 30,
    });
    expect(view.error).toBeUndefined();

    // Same filter find-select.spec.ts proves resolves to exactly 13 features
    // against the loaded dataset -- a real, non-trivial selection, not a
    // hand-picked id list.
    const selected = await callTool(page, "select_features", {
      near: "Daan Park",
      radius_m: 800,
      categories: ["park", "school"],
    });
    expect(selected.error).toBeUndefined();

    const agentDrawing = await callTool(page, "draw_shape", {
      type: "circle",
      center: { lng: 121.5389, lat: 25.0357 },
      radius_m: 250,
      label: "10-minute walk",
    });
    expect(agentDrawing.error).toBeUndefined();

    // draw_shape only ever produces source "agent"; adding one directly to
    // the store is the only way to also prove a *human's* shape survives
    // the round trip still labelled "user", which is the promise
    // get_share_link's own description makes.
    const userDrawing = await page.evaluate(() =>
      window.__glassmapStore!.getState().addDrawing({
        source: "user",
        kind: "polygon",
        label: "手繪路線",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [121.5, 25.02],
              [121.51, 25.02],
              [121.51, 25.03],
              [121.5, 25.02],
            ],
          ],
        },
      }),
    );
    expect(userDrawing.source).toBe("user");

    const cjkNote = "近大安森林公園，適合野餐 🌳";
    const annotation = await callTool(page, "annotate", {
      at: { lng: 121.5389, lat: 25.0357 },
      note: cjkNote,
    });
    expect(annotation.error).toBeUndefined();

    const before = await callTool(page, "get_map_state");
    expect(before.drawings!.count).toBe(2);
    expect(before.annotations!.count).toBe(1);

    const share = await callTool(page, "get_share_link");
    expect(share.error).toBeUndefined();
    expect(share.url).toBeDefined();
    expect(share.url!.startsWith(page.url().split("#")[0])).toBe(true);

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    // A fresh context is not covered by fixtures.ts's auto-block (that one
    // only routes the default context Playwright hands this test) -- without
    // this, the "recipient" page would make a real request to
    // tiles.openfreemap.org (T-13).
    await blockExternalNetwork(page2);
    const errors2: string[] = [];
    page2.on("pageerror", (err) => errors2.push(err.message));

    await page2.goto(share.url!);
    await waitForTools(page2);
    await waitForFeatures(page2);

    await expect(page2.getByTestId("zoom")).toHaveText(String(before.zoom));
    await expect(page2.getByTestId("center")).toHaveText(`${before.center!.lng}, ${before.center!.lat}`);
    await expect(page2.getByTestId("bearing")).toHaveText(String(before.bearing));
    await expect(page2.getByTestId("pitch")).toHaveText(String(before.pitch));
    await expect(page2.getByTestId("selection-count")).toHaveText(String(before.selection!.count));
    await expect(page2.getByTestId("drawing-count")).toHaveText("2");
    await expect(page2.getByTestId("annotation-count")).toHaveText("1");

    const restored = await callTool(page2, "get_map_state");
    expect(restored.center).toEqual(before.center);
    expect(restored.zoom).toBe(before.zoom);
    expect(restored.bearing).toBe(before.bearing);
    expect(restored.pitch).toBe(before.pitch);
    expect(restored.selection!.count).toBe(before.selection!.count);
    expect([...restored.selection!.ids].sort()).toEqual([...before.selection!.ids].sort());

    // Both the tool-drawn shape and the hand-added one, each still labelled
    // with who made it -- the round trip must not relabel or drop either.
    expect(restored.drawings!.items).toEqual([
      expect.objectContaining({ kind: "circle", source: "agent", label: "10-minute walk" }),
      expect.objectContaining({ kind: "polygon", source: "user", label: "手繪路線" }),
    ]);
    expect(restored.annotations!.items).toHaveLength(1);
    expect(restored.annotations!.items[0]!.note).toBe(cjkNote);

    await context2.close();
    expect(errors2).toEqual([]);
  });

  test("a link this build produced is not rewritten: the hash stays byte-identical after it settles", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);

    await callTool(page, "set_map_view", {
      center: { lng: 121.5301, lat: 25.0412 },
      zoom: 14,
      bearing: 200,
      pitch: 20,
    });
    const drawn = await callTool(page, "draw_shape", {
      type: "circle",
      center: { lng: 121.5301, lat: 25.0412 },
      radius_m: 250,
      label: "quiescence probe",
    });
    expect(drawn.error).toBeUndefined();

    const share = await callTool(page, "get_share_link");
    expect(share.error).toBeUndefined();
    const hashFragment = `#${share.url!.split("#")[1]}`;

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    // A fresh context is not covered by fixtures.ts's auto-block (that one
    // only routes the default context Playwright hands this test) -- without
    // this, the "recipient" page would make a real request to
    // tiles.openfreemap.org (T-13).
    await blockExternalNetwork(page2);
    const errors2: string[] = [];
    page2.on("pageerror", (err) => errors2.push(err.message));

    await page2.goto(share.url!);
    await waitForTools(page2);
    // Restoration itself is synchronous inside the mount effect (before the
    // write-back debounce even starts), so this settles well under the
    // window below -- polling it first proves the eventual hash comparison
    // is not just catching the page before it finished loading.
    await expect(page2.getByTestId("drawing-count")).toHaveText("1");

    // What is under test here is an *absence*: useShareHash re-encodes on
    // every load (its own unconditional `schedule()` call, so a
    // partially-rejected link still gets canonicalised -- see the next
    // test), and the seed's own encode must land back on the identical
    // string for a link this build produced itself. There is no DOM signal
    // to poll for "no write happened", so this is the one place in the
    // suite that waits out the real debounce window instead: tied to the
    // app's own SHARE_WRITE_DEBOUNCE_MS constant plus margin, not a guessed
    // number.
    await page2.waitForTimeout(SHARE_WRITE_DEBOUNCE_MS + 200);
    const hashAfter = await page2.evaluate(() => location.hash);

    await context2.close();
    expect(errors2).toEqual([]);
    expect(hashAfter).toBe(hashFragment);
  });

  test("history stays flat: several camera moves and a drawing update the hash without pushing entries", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);

    const historyBefore = await page.evaluate(() => history.length);
    const hashBefore = await page.evaluate(() => location.hash);

    await callTool(page, "set_map_view", { center: { lng: 121.52, lat: 25.04 }, zoom: 13 });
    await callTool(page, "set_map_view", { center: { lng: 121.53, lat: 25.05 }, zoom: 14 });
    await callTool(page, "set_map_view", { center: { lng: 121.54, lat: 25.06 }, zoom: 15 });
    const drawn = await callTool(page, "draw_shape", {
      type: "circle",
      center: { lng: 121.54, lat: 25.06 },
      radius_m: 300,
    });
    expect(drawn.error).toBeUndefined();

    // Debounced writes can fire more than once while flyTo animations settle
    // (camera write-backs each reschedule a write), so a single decode after
    // "hash changed" can catch an intermediate camera on a slow machine (seen
    // in CI push run 33162552056). Poll until the DECODED state converges on
    // the final command instead of decoding one arbitrary snapshot.
    await expect
      .poll(
        async () => {
          const hash = await page.evaluate(() => location.hash);
          if (!hash.startsWith("#v1.")) return "no v1 hash yet";
          const decoded = decodeShareState(hash);
          if ("error" in decoded) return `undecodable: ${decoded.error}`;
          return `${decoded.view.center.join(",")} z${decoded.view.zoom} d${decoded.drawings.length}`;
        },
        { message: "the address bar should converge on the final camera + drawing" },
      )
      .toBe("121.54,25.06 z15 d1");

    const historyAfter = await page.evaluate(() => history.length);
    expect(historyAfter).toBe(historyBefore);

    // Flat history alone would also be true of a bar that never wrote at all
    // (e.g. a broken subscription that silently drops every schedule()) --
    // proving the fragment actually changed from its pre-move value is what
    // makes "updates the hash" in this test's title a real assertion.
    const hashAfter = await page.evaluate(() => location.hash);
    expect(hashAfter).not.toBe(hashBefore);
  });

  test("a link with one valid and one impossible drawing keeps the valid one and canonicalises the bar", async ({
    page,
  }) => {
    const validCircle = { k: "circle", o: "agent", c: [121.5478, 25.0478], r: 300 };
    // lng/lat both outside +/-180 / +/-90: isLngLat rejects it outright, so
    // decodeDrawing drops it rather than clamping it into something on the map.
    const impossibleCircle = { k: "circle", o: "agent", c: [999, 999], r: 300 };
    const craftedFragment = `#${wireHash({
      c: [121.5175, 25.0478],
      z: 13,
      d: [validCircle, impossibleCircle],
    })}`;

    await page.goto(`/${craftedFragment}`);
    await waitForTools(page);

    // Only the valid drawing survives.
    await expect(page.getByTestId("drawing-count")).toHaveText("1");

    // ...and the address bar no longer promises the one that was dropped:
    // poll for the canonical rewrite (it must differ from what we hand-fed
    // it, since that payload had two drawings and the store now holds one).
    await expect
      .poll(() => page.evaluate(() => location.hash), {
        message: "a partially-rejected link should be canonicalised, not left advertising the drop",
      })
      .not.toBe(craftedFragment);

    const finalHash = await page.evaluate(() => location.hash);
    const decoded = decodeShareState(finalHash);
    if ("error" in decoded) throw new Error(`expected a decodable canonical link, got: ${decoded.error}`);
    expect(decoded.drawings).toHaveLength(1);
    expect(decoded.drawings[0]).toMatchObject({
      kind: "circle",
      center: [121.5478, 25.0478],
      radius_m: 300,
    });
  });

  test("no hash, no WebGL2: a canonical #v1 fragment still seeds, decoding to the default view", async ({
    page,
  }) => {
    await forceNoWebGL2(page);
    await page.goto("/");
    await waitForTools(page);

    await expect
      .poll(() => page.evaluate(() => location.hash), {
        message: "the address bar should get a canonical v1 fragment even with no live map",
      })
      .toMatch(/^#v1\./);

    const hash = await page.evaluate(() => location.hash);
    const decoded = decodeShareState(hash);
    if ("error" in decoded) throw new Error(`expected a decodable seed link, got: ${decoded.error}`);
    expect(decoded.view).toEqual(DEFAULT_VIEW);
    expect(decoded.selection).toEqual([]);
    expect(decoded.drawings).toEqual([]);
    expect(decoded.annotations).toEqual([]);

    // The existing guarantee (T-30's approximate-bounds fallback, guarded in
    // data-and-view.spec.ts): bounds becomes non-null even with no WebGL2.
    await expect
      .poll(async () => (await callTool(page, "get_map_state")).bounds, {
        message: "bounds should become non-null via the approximate fallback",
      })
      .not.toBeNull();
  });

  test("a junk fragment is ignored: default view loads with no pageerror, and the bar gets a canonical link", async ({
    page,
  }) => {
    await page.goto("/#section-two");
    await waitForTools(page);

    await expect(page.getByTestId("zoom")).toHaveText(String(DEFAULT_VIEW.zoom));
    await expect(page.getByTestId("center")).toHaveText(
      `${DEFAULT_VIEW.center[0]}, ${DEFAULT_VIEW.center[1]}`,
    );
    await expect(page.getByTestId("bearing")).toHaveText(String(DEFAULT_VIEW.bearing));
    await expect(page.getByTestId("pitch")).toHaveText(String(DEFAULT_VIEW.pitch));

    await expect
      .poll(() => page.evaluate(() => location.hash), {
        message: "'#section-two' should be replaced by a canonical v1 fragment, not left in the bar",
      })
      .toMatch(/^#v1\./);
    // pageErrors (fixtures.ts, auto) asserts no uncaught exception at teardown --
    // applyShareHash's `{ error }` branch for an unrecognised fragment must
    // not throw.
  });

  test("budget freeze: a drawing over the URL limit locks the bar and says so; removing it clears the status", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTools(page);
    await waitForFeatures(page);
    await waitForStoreHandle(page);

    await expect(page.getByTestId("share-status")).toHaveText("");
    await expect
      .poll(() => page.evaluate(() => location.hash))
      .toMatch(/^#v1\./);
    const stableHash = await page.evaluate(() => location.hash);

    // A 500-point ring: share-hash.test.ts's own "stops writing once the map
    // outgrows a URL" test uses the identical shape to cross MAX_SHARE_URL_BYTES.
    await page.evaluate((ring) => {
      window.__glassmapStore!.getState().addDrawing({
        source: "user",
        kind: "polygon",
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }, bigRing(500));

    expect(SHARE_TOO_LARGE_MESSAGE).toBe("state too large for the link");
    await expect(page.getByTestId("share-status")).toHaveText(SHARE_TOO_LARGE_MESSAGE);
    // The previous, still-valid fragment is left exactly as it was -- never
    // a truncated one.
    expect(await page.evaluate(() => location.hash)).toBe(stableHash);

    await page.evaluate(() => {
      const store = window.__glassmapStore!.getState();
      const last = store.drawings.at(-1) as Drawing;
      store.removeDrawing(last.id);
    });

    await expect(page.getByTestId("share-status")).toHaveText("");
  });
});
