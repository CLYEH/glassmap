"use client";

import dynamic from "next/dynamic";
import { ActivityFeed, ActivityTicker } from "@/components/ActivityFeed";
import { AgentWhisper } from "@/components/AgentWhisper";
import { Attribution } from "@/components/Attribution";
import { BrandBar } from "@/components/BrandBar";
import { Inspector } from "@/components/Inspector";
import { LoadedCategories } from "@/components/LoadedCategories";
import { MarkerStatus } from "@/components/MarkerStatus";
import { OnTheMapCard } from "@/components/OnTheMapCard";
import { PlacesDock } from "@/components/PlacesTray";
import { ShareRestoreNotice } from "@/components/ShareRestoreNotice";
import { ShareStatus } from "@/components/ShareStatus";
import { StateOverlay } from "@/components/StateOverlay";
import { Tools } from "@/components/Tools";
import { WebMcpBadge } from "@/components/WebMcpBadge";
import { AwakenStage } from "@/components/awaken/AwakenStage";
import { useAwakenController } from "@/components/awaken/controller";
import { FxLayer } from "@/components/fx/FxLayer";
import { RestoredChip } from "@/components/RestoredChip";
import { useDevStoreHandle } from "@/components/dev-store-handle";
import { useAwakenMode } from "@/components/useAwakenMode";
import { useFeatureData } from "@/components/useFeatureData";

// MapLibre needs window/WebGL at import time, so it never runs on the server.
const MapCanvas = dynamic(() => import("@/components/MapCanvas"), { ssr: false });

/**
 * The map is the page, and the page has two states.
 *
 * **Human (`html[data-chrome="idle"]`).** What a visitor gets: the brand, the three
 * things they can do (Draw, Note, Share), the Places dock — the map's scale on
 * its pill, the key and the browsable city inside it — the attribution, and one
 * whisper in the corner saying the map is also readable by agents. No feed, no
 * tool roster, no "WebMCP live" badge, no inspector lane — a person who came to
 * look at Taipei is not shown a dashboard about a protocol they did not ask
 * about (BRIEF item 3).
 *
 * **Agent (`html[data-chrome="awake"]`).** The moment an agent acts — the first
 * `activity` row, or a restored link that carries agent work — the agent chrome
 * arrives: the activity feed down the west edge, the inspector lane in the
 * east, the camera chip, and the badge that says who is here. The mode is
 * `src/lib/awaken/`'s own `bootMode`, read through `useAwakenMode`, so the
 * chrome and the awakening cannot disagree about what state the page is in.
 *
 * **The crossing itself (`html[data-chrome="waking"]`).** It is not a flip: for
 * 1800 ms the agent chrome *arrives* — the feed condenses out of light, the
 * lane slides in from the east displacing the tools and the corner in exact
 * sync, the spark hands over to the badge, the first call writes itself, and a
 * toast says out loud what happened (`components/awaken/`). The panels mount
 * for `waking` because the story needs something to move; the human surfaces
 * stay until `awake` because the story is made of them leaving.
 *
 * `useAwakenController` mounts the one controller this document may have, and
 * it is mounted *here*, in the page, rather than inside `AwakenStage`: React
 * runs child effects before parent ones, so a controller in a child would boot
 * before `ShareStatus` had applied the URL fragment and would write the human
 * chrome over the boot script's answer for a frame.
 *
 * The attribute lives on the root element, written by the controller and,
 * before hydration, by the inline script in `layout.tsx` — a restored agent
 * link has to be dressed correctly at the first paint, and a URL fragment never
 * reaches the server, so nothing React renders can know it in time. The
 * lifecycle attribute `body[data-awaken]` carries the same three values for
 * e2e, which waits on "awake" rather than on a frame. The panels themselves
 * still arrive with hydration — this JSX is what mounts them — so what the
 * script buys is that nothing which is only true of the human chrome is ever
 * painted on an agent's link.
 *
 * Below 921px the inspector is a bottom sheet and the map is shortened to sit
 * above it (globals.css) — in human chrome there is no sheet, so the map keeps
 * the whole screen.
 *
 * `ShareStatus` runs the URL-hash mirror, and a shared link has to reach the
 * store before the map reads its opening camera out of it (otherwise the map
 * opens at the default view and flies). That ordering is safe wherever this
 * component puts it: `MapCanvas` is a `next/dynamic` import, so its effect
 * cannot run in the same commit as the rest of the page's.
 */
export default function Home() {
  useFeatureData();
  useDevStoreHandle();
  useAwakenController();
  const mode = useAwakenMode();
  /** Is the agent chrome on screen at all — arriving counts. */
  const agent = mode !== "idle";
  /** Are the human-only surfaces still there — they leave *during* the story. */
  const human = mode !== "awake";

  return (
    <main data-testid="map-page" className="app">
      {/* Every floating chip lives inside the map, not beside it: below 921px
          the map is shortened to sit above the sheet, and the chrome has to
          come with it — the attribution most of all, since it is a licence
          condition and must not end up behind the sheet. */}
      <div className="map-wrap">
        <MapCanvas />

        {/* Agent presence: transient marks that say what a tool call just did
            to the map. Two layers, both pointer-events: none — the map-space
            SVG sits under the scrims with the map furniture it comments on,
            the viewport layer above them and below the glass chrome. */}
        <FxLayer />

        {/* The one-time transformation: the light it is made of, and the toast
            it ends on. Beside `FxLayer` because it is the same kind of thing —
            imperative, per-frame, pointer-transparent — and because the two
            must never both be driving the same node. */}
        <AwakenStage />

        <div className="scrim-top" aria-hidden />
        <div className="scrim-bottom" aria-hidden />

        <BrandBar />
        <RestoredChip />
        {agent ? <ActivityFeed /> : null}
        {agent ? <ActivityTicker /> : null}
        <Tools />
        <OnTheMapCard />
        <PlacesDock />

        <div className="bottom-bar">
          {/* Loaded-but-unpainted categories, in the corner the legend used to
              hold. It has to be readable without opening anything: it exists
              because a tool can add thousands of searchable places and change
              nothing on screen, and a disclosure a person must go looking for
              does not close that gap. The key it is the counterpart of now
              lives one surface over, in the Places tray. */}
          <LoadedCategories />
          <div className="corner">
            {/* Both are about the link rather than about the map, so they share
                the corner above the attribution: one says the map has outgrown
                a URL, the other that a link this page opened asked for data it
                could not get. */}
            <ShareRestoreNotice />
            <ShareStatus />
            {/* The whisper and the badge are the same corner slot in the two
                chromes: "an agent could read this" until one does, then "an
                agent is reading this". During the transition both are mounted
                — the handover from the spark to the badge is a beat of the
                story, not a swap between two renders. */}
            {human ? <AgentWhisper /> : null}
            <Attribution />
            <WebMcpBadge />
          </div>
        </div>
      </div>

      {agent ? <Inspector /> : null}
      <StateOverlay />
      {/* Off screen: what the bead layers have been asked to draw, in words —
          the map's marks are pixels on a canvas, and a headless run has no
          canvas to read. See `MarkerStatus`. */}
      <MarkerStatus />
    </main>
  );
}
