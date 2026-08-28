import { test as base, expect } from "@playwright/test";

/**
 * Every spec in this suite imports `test`/`expect` from here instead of
 * `@playwright/test` directly. `pageErrors` starts collecting uncaught
 * exceptions from page creation, before `goto`, so a tool call, a MapLibre
 * callback or a React render that throws fails the test even if no
 * assertion happened to notice. Each test should end with
 * `expect(pageErrors).toEqual([])`.
 */
export const test = base.extend<{ pageErrors: string[] }>({
  // Playwright's fixture API conventionally names this second parameter
  // `use`; renamed here so eslint-plugin-react-hooks does not mistake this
  // Playwright fixture for a React hook call.
  pageErrors: async ({ page }, provideToTest) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await provideToTest(errors);
  },
});

export { expect };
