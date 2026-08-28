import { test as base, expect, type Page } from "@playwright/test";

/**
 * Every spec in this suite imports `test`/`expect` from here instead of
 * `@playwright/test` directly. `pageErrors` is an auto fixture: it starts
 * collecting uncaught exceptions from page creation, before `goto`, and
 * asserts there were none once the test body finishes -- so a tool call, a
 * MapLibre callback or a React render that throws fails the test even if no
 * assertion in the test itself happened to notice. No per-test boilerplate
 * needed; a test only needs to destructure `pageErrors` if it wants to
 * inspect the list itself.
 *
 * `blockedRequests` is the second auto fixture (T-13): it aborts every
 * request this suite's default page/context makes to a non-localhost host,
 * so the suite never depends on -- or fails because of -- a third-party
 * CDN's uptime. See CI run 33160728189 (PR #27): a GitHub runner unable to
 * reach `tiles.openfreemap.org` failed share-link.spec.ts's round-trip spec
 * on a camera-write-back desync, not a real product bug. The app's own
 * "basemap style/tiles never load" path (`map-status: "error"`, bounds
 * still available via the constructor-time read, every tool still working)
 * is a documented product guarantee -- exercising it on every run, instead
 * of only when a CDN happens to be down, is strictly more coverage, not
 * less.
 */
const LIVE_BASEMAP = process.env.E2E_LIVE_BASEMAP === "1";

/** Only same-origin (the `next dev` server this suite drives) may pass. */
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isAllowedHost(url: string): boolean {
  try {
    return ALLOWED_HOSTS.has(new URL(url).hostname);
  } catch {
    // A malformed/relative URL is not a real network request; let it through
    // rather than mask it as a "blocked" one.
    return true;
  }
}

export const test = base.extend<{ pageErrors: string[]; blockedRequests: string[] }>({
  pageErrors: [
    // Playwright's fixture API conventionally names this second parameter
    // `use`; renamed here so eslint-plugin-react-hooks does not mistake this
    // Playwright fixture for a React hook call.
    async ({ page }, provideToTest) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await provideToTest(errors);
      expect(errors, "no uncaught page errors").toEqual([]);
    },
    { auto: true },
  ],

  /**
   * URLs this fixture actually aborted, exposed so a test can prove the app
   * really attempted -- and was blocked from completing -- an external call
   * (see network-isolation.spec.ts) rather than the block being vacuously
   * unexercised. Skipped entirely when `E2E_LIVE_BASEMAP=1` (the opt-in
   * smoke spec needs the real CDN reachable; see basemap-live.spec.ts).
   *
   * Only covers Playwright's own `context`/`page` fixtures. A spec that
   * opens an ADDITIONAL context via `browser.newContext()` (share-link.spec.ts,
   * simulating a fresh recipient opening a pasted link) must call
   * `blockExternalNetwork` on that page itself -- a fresh context has no
   * route of its own.
   *
   * `requestfinished` is watched independently of the `route` abort as a
   * safety net: `route("**\/*", ...)` matches every request Playwright can
   * see, so nothing should ever reach `escaped`, but if a future change
   * narrows the pattern or `isAllowedHost` gets a host added to it by
   * mistake, this fails loud instead of quietly leaking a real network call.
   */
  blockedRequests: [
    async ({ context }, provideToTest) => {
      const blocked: string[] = [];
      const escaped: string[] = [];

      if (!LIVE_BASEMAP) {
        await context.route("**/*", (route) => {
          const url = route.request().url();
          if (isAllowedHost(url)) return route.continue();
          blocked.push(url);
          return route.abort();
        });
        context.on("requestfinished", (request) => {
          if (!isAllowedHost(request.url())) escaped.push(request.url());
        });
      }

      await provideToTest(blocked);

      expect(escaped, "no request to a non-localhost host should ever complete").toEqual([]);
    },
    { auto: true },
  ],
});

/**
 * Applies the same non-localhost block `blockedRequests` puts on the default
 * context to a page/context this suite created itself, e.g. the second
 * `browser.newContext()` share-link.spec.ts opens to simulate a fresh
 * recipient opening a pasted link. No-op when `E2E_LIVE_BASEMAP=1`, matching
 * the auto fixture above. Must be called before `page.goto`.
 */
export async function blockExternalNetwork(page: Page): Promise<void> {
  if (LIVE_BASEMAP) return;
  await page.route("**/*", (route) =>
    isAllowedHost(route.request().url()) ? route.continue() : route.abort(),
  );
}

export { expect };
