import { describe, expect, it } from "vitest";
import { selectAwakenMode } from "./useAwakenMode";

/**
 * One rule decides which chrome the whole page wears, and the point of this
 * file is that it is not a *second* rule: `selectAwakenMode` is
 * `src/lib/awaken/`'s `bootMode` applied to the store, so the chrome cannot
 * come to a different conclusion from the trigger that narrates the change.
 * The orderings themselves are proven in `lib/awaken/awaken.test.ts`; these
 * are the four store states the components ask about.
 */
describe("selectAwakenMode", () => {
  it("is idle on a page nothing has happened on", () => {
    // The landing: no feed, no badge, no lane (page.tsx).
    expect(selectAwakenMode({ activity: [], restoredAgentState: false })).toBe("idle");
  });

  it("is awake from the first recorded tool call", () => {
    // One activity row is an agent acting on this page, now — including the
    // declarative note form's agent branch, which never goes through the tool
    // layer but does write activity.
    expect(selectAwakenMode({ activity: [{}], restoredAgentState: false })).toBe("awake");
  });

  it("is awake for a link that arrived carrying agent work", () => {
    // A restored map must never be shown in human chrome, which is why
    // `applyShareHash` writes this flag before it writes the camera.
    expect(selectAwakenMode({ activity: [], restoredAgentState: true })).toBe("awake");
  });

  it("stays awake once both are true", () => {
    expect(selectAwakenMode({ activity: [{}], restoredAgentState: true })).toBe("awake");
  });
});
