"use client";

import dynamic from "next/dynamic";
import { ActivityFeed, ActivityTicker } from "@/components/ActivityFeed";
import { Attribution } from "@/components/Attribution";
import { BrandBar } from "@/components/BrandBar";
import { DrawToolbar } from "@/components/DrawToolbar";
import { Inspector } from "@/components/Inspector";
import { Legend } from "@/components/Legend";
import { ShareRestoreNotice } from "@/components/ShareRestoreNotice";
import { ShareStatus } from "@/components/ShareStatus";
import { StateOverlay } from "@/components/StateOverlay";
import { WebMcpBadge } from "@/components/WebMcpBadge";
import { useDevStoreHandle } from "@/components/dev-store-handle";
import { useFeatureData } from "@/components/useFeatureData";

// MapLibre needs window/WebGL at import time, so it never runs on the server.
const MapCanvas = dynamic(() => import("@/components/MapCanvas"), { ssr: false });

/**
 * The map is the page. Everything else is dark glass floating on it: the brand
 * and camera top left, the agent's activity down the west edge, what is on the
 * map in the east lane, and one flex row along the bottom carrying the legend
 * at one end and the attribution and WebMCP badge at the other — which is why
 * they cannot collide however narrow the window gets.
 *
 * Below 921px the inspector becomes a bottom sheet and the map is shortened to
 * sit above it (globals.css); the feed moves into the sheet's Activity tab and
 * the last call rides a ticker over the map.
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
  return (
    <main data-testid="map-page" className="app">
      {/* Every floating chip lives inside the map, not beside it: below 921px
          the map is shortened to sit above the sheet, and the chrome has to
          come with it — the attribution most of all, since it is a licence
          condition and must not end up behind the sheet. */}
      <div className="map-wrap">
        <MapCanvas />

        <div className="scrim-top" aria-hidden />
        <div className="scrim-bottom" aria-hidden />

        <BrandBar />
        <ActivityFeed />
        <ActivityTicker />
        <DrawToolbar />

        <div className="bottom-bar">
          <Legend />
          <div className="corner">
            {/* Both are about the link rather than about the map, so they share
                the corner above the attribution: one says the map has outgrown
                a URL, the other that a link this page opened asked for data it
                could not get. */}
            <ShareRestoreNotice />
            <ShareStatus />
            <Attribution />
            <WebMcpBadge />
          </div>
        </div>
      </div>

      <Inspector />
      <StateOverlay />
    </main>
  );
}
