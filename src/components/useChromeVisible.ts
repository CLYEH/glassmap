"use client";

import { useAwakenStore } from "./awaken/mode-store";
import { chromeVisible, usePanelStore } from "./panel-store";

/**
 * Is the agent chrome on screen — for React.
 *
 * The one selector everything that mounts, hides or measures the agent chrome
 * reads, so "is the lane there" is answered in exactly one place: `page.tsx`
 * mounts the feed, the ticker and the inspector from it, the badge chooses its
 * form from it, and `MapCanvas` derives the corridor from the same function
 * through `readChromeVisible()`. A second definition anywhere would be a
 * `bounds` value describing a rectangle that is not on screen.
 *
 * Two stores rather than one, and neither of them the map store: the machine's
 * mode (`awaken/mode-store.ts`, written only by the awakening controller) and
 * the human's override (`panel-store.ts`). `chromeVisible` is the composition,
 * and it is pure so the precedence can be asserted without a renderer.
 */
export function useChromeVisible(): boolean {
  const mode = useAwakenStore((s) => s.mode);
  const panel = usePanelStore((s) => s.panel);
  return chromeVisible(mode, panel);
}
