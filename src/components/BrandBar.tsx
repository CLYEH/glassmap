"use client";

import { useMapStore } from "@/lib/store/map-store";

/** 4 decimals is ~11 m: the precision a human reads off a map corner. */
const dms = (value: number) => Math.abs(value).toFixed(4);

/** Zoom to one decimal, without a trailing ".0" — z12, z13.4. */
const zoomLabel = (zoom: number) => `z${Math.round(zoom * 10) / 10}`;

/**
 * The top-left cluster: who this is, and — once an agent is here — where the
 * camera is.
 *
 * The camera chip is the human-readable half of `get_map_state`: the same
 * numbers a tool reads, in the register a person reads. Its glyph is a scope
 * (circle, centre dot, crosshair ticks) and deliberately not the plain
 * circle-dot the inspector's "Selected" header uses — two concepts, two marks.
 *
 * It is agent chrome, so it is hidden in the human landing (globals.css keys
 * off `html[data-chrome]`, which is set before the first paint) rather than
 * unmounted: nobody browsing a city needs
 * five decimal places of their own camera, but the readout is the machine
 * mirror of a value tools write, and taking it out of the DOM would take it out
 * of reach of a headless run.
 */
export function BrandBar() {
  const view = useMapStore((s) => s.view);
  const [lng, lat] = view.center;

  return (
    <div className="brand-cluster" data-testid="brand-bar">
      <div className="brand lg lens">
        {/* Teal frame = the agent's view of the map, rose centre = the human's
            place in it. Split solid colours so both survive at 20px. */}
        <svg className="logomark" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect
            x="3.2"
            y="3.2"
            width="13.6"
            height="13.6"
            rx="2.5"
            transform="rotate(45 10 10)"
            stroke="#2dd4bf"
            strokeWidth="1.6"
          />
          <circle cx="10" cy="10" r="2.1" fill="#f48fb1" />
        </svg>
        <span className="brand-name">GlassMap</span>
        <span className="brand-city">TAIPEI</span>
      </div>

      <div className="cam-chip lg" data-testid="camera-chip">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <circle cx="5" cy="5" r="3.2" stroke="#b9c3ce" />
          <circle cx="5" cy="5" r="1" fill="#b9c3ce" />
          <path d="M5 .4v1.6M5 8v1.6M.4 5H2M8 5h1.6" stroke="#b9c3ce" strokeLinecap="round" />
        </svg>
        <span data-testid="camera-readout">
          {dms(lat)}° {lat < 0 ? "S" : "N"}&nbsp; {dms(lng)}° {lng < 0 ? "W" : "E"}
          &nbsp;·&nbsp;
          <span className="z">{zoomLabel(view.zoom)}</span>
        </span>
      </div>
    </div>
  );
}
