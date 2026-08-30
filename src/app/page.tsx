"use client";

import dynamic from "next/dynamic";
import { ActivityFeed, ActivityTicker } from "@/components/ActivityFeed";
import { AgentWhisper } from "@/components/AgentWhisper";
import { Attribution } from "@/components/Attribution";
import { BrandBar } from "@/components/BrandBar";
import { Inspector } from "@/components/Inspector";
import { Legend } from "@/components/Legend";
import { MarkerStatus } from "@/components/MarkerStatus";
import { OnTheMapCard } from "@/components/OnTheMapCard";
import { PlacesDock } from "@/components/PlacesTray";
import { ShareRestoreNotice } from "@/components/ShareRestoreNotice";
import { ShareStatus } from "@/components/ShareStatus";
import { StateOverlay } from "@/components/StateOverlay";
import { Tools } from "@/components/Tools";
import { WebMcpBadge } from "@/components/WebMcpBadge";
import { FxLayer } from "@/components/fx/FxLayer";
import { useDevStoreHandle } from "@/components/dev-store-handle";
import { useAwakenMode } from "@/components/useAwakenMode";
import { useFeatureData } from "@/components/useFeatureData";

// MapLibre needs window/WebGL at import time, so it never runs on the server.
const MapCanvas = dynamic(() => import("@/components/MapCanvas"), { ssr: false });

/**
 * The map is the page, and the page has two states.
 *
 * **Human (`data-chrome="idle"`).** What a visitor gets: the brand, the three
 * things they can do (Draw, Note, Share), the Places tray to browse the city
 * with, the legend's scale, the attribution, and one whisper in the corner
 * saying the map is also readable by agents. No feed, no tool roster, no
 * "WebMCP live" badge, no inspector lane — a person who came to look at Taipei
 * is not shown a dashboard about a protocol they did not ask about (BRIEF
 * item 3).
 *
 * **Agent (`data-chrome="awake"`).** The moment an agent acts — the first
 * `activity` row, or a restored link that carries agent work — the agent chrome
 * arrives: the activity feed down the west edge, the inspector lane in the
 * east, the camera chip, and the badge that says who is here. The mode is
 * `src/lib/awaken/`'s own `bootMode`, read through `useAwakenMode`, so the
 * chrome and the awakening cannot disagree about what state the page is in.
 *
 * In this cut the crossing is instantaneous. The choreography that makes it
 * *legible* — the 1800 ms transition, `body[data-awaken]`, the toast — is
 * T-83's, and it replaces the flip without moving anything below.
 *
 * The attribute lives on `main` rather than on `body` for one practical reason:
 * `body` belongs to the awakening controller (`body[data-awaken]`, the e2e
 * lifecycle contract), and two writers on one attribute is how a page ends up
 * half dressed.
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
  const mode = useAwakenMode();
  const awake = mode !== "idle";

  return (
    <main data-testid="map-page" className="app" data-chrome={mode}>
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

        <div className="scrim-top" aria-hidden />
        <div className="scrim-bottom" aria-hidden />

        <BrandBar />
        {awake ? <ActivityFeed /> : null}
        {awake ? <ActivityTicker /> : null}
        <Tools />
        <OnTheMapCard />
        <PlacesDock />

        <div className="bottom-bar">
          <Legend />
          <div className="corner">
            {/* Both are about the link rather than about the map, so they share
                the corner above the attribution: one says the map has outgrown
                a URL, the other that a link this page opened asked for data it
                could not get. */}
            <ShareRestoreNotice />
            <ShareStatus />
            {/* The whisper and the badge are the same corner slot in the two
                chromes: "an agent could read this" until one does, then "an
                agent is reading this". */}
            {awake ? null : <AgentWhisper />}
            <Attribution />
            <WebMcpBadge />
          </div>
        </div>
      </div>

      {awake ? <Inspector /> : null}
      <StateOverlay />
      {/* Off screen: what the bead layers have been asked to draw, in words —
          the map's marks are pixels on a canvas, and a headless run has no
          canvas to read. See `MarkerStatus`. */}
      <MarkerStatus />
    </main>
  );
}
