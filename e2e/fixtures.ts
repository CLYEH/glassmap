import { test as base, expect } from "@playwright/test";

/**
 * Every spec in this suite imports `test`/`expect` from here instead of
 * `@playwright/test` directly. `pageErrors` is an auto fixture: it starts
 * collecting uncaught exceptions from page creation, before `goto`, and
 * asserts there were none once the test body finishes -- so a tool call, a
 * MapLibre callback or a React render that throws fails the test even if no
 * assertion in the test itself happened to notice. No per-test boilerplate
 * needed; a test only needs to destructure `pageErrors` if it wants to
 * inspect the list itself.
 */
export const test = base.extend<{ pageErrors: string[] }>({
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
});

export { expect };
