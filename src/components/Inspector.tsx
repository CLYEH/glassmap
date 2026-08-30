"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isFeatureCategory } from "@/lib/data/schema";
import { useMapStore, type Annotation, type Drawing } from "@/lib/store/map-store";
import { ActivityPanel } from "./ActivityFeed";
import { selectActivity } from "./activity-model";
import { categorySingular } from "./category-labels";
import { emitHumanFx } from "./fx/human-events";
import { CATEGORY_COLOR } from "./map-style";
import { selectionClaim, type SelectionClaim } from "./restored-model";
import { resolveSelection, type SelectedRow } from "./selection-model";
import { ASK_CARDS, TryAsking } from "./TryAsking";
import { SHEET_TIER, useMediaQuery } from "./useMediaQuery";

/** Who put it there. Teal = agent, rose = human, as on the map itself. */
function Source({ source }: { source: Drawing["source"] }) {
  return <span className={source === "agent" ? "src-agent" : "src-user"}>{source}</span>;
}

function SectionHead({
  icon,
  title,
  count,
  testid,
  highlight,
  tag,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  testid: string;
  highlight?: boolean;
  /** Who put these here, when the page can say so honestly (`selectionClaim`). */
  tag?: SelectionClaim | null;
}) {
  return (
    <div className="sec-head">
      {icon}
      <h3>{title}</h3>
      {tag ? (
        <span className={`sec-tag${tag === "YOU" ? " you" : ""}`} data-testid={`${testid}-tag`}>
          {tag}
        </span>
      ) : null}
      <span className={`sec-count${highlight && count > 0 ? " active" : ""}`} data-testid={testid}>
        {count}
      </span>
    </div>
  );
}

const SelectedIcon = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
    <circle cx="6" cy="6" r="4.4" stroke="#b9c3ce" strokeWidth="1.2" />
    <circle cx="6" cy="6" r="1.4" fill="#b9c3ce" />
  </svg>
);

const ShapesIcon = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path
      d="M6 1.6 10.4 4.8 8.7 9.9H3.3L1.6 4.8 6 1.6Z"
      stroke="#b9c3ce"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

const NotesIcon = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path
      d="M6 1.2a3.4 3.4 0 0 1 3.4 3.4C9.4 7 6 10.8 6 10.8S2.6 7 2.6 4.6A3.4 3.4 0 0 1 6 1.2Z"
      stroke="#b9c3ce"
      strokeWidth="1.2"
    />
    <circle cx="6" cy="4.6" r="1.2" fill="#b9c3ce" />
  </svg>
);

function DrawingSwatch({ drawing }: { drawing: Drawing }) {
  const color = drawing.source === "agent" ? "#2dd4bf" : "#f48fb1";
  return (
    <svg className="obj-swatch" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle
        cx="9"
        cy="9"
        r="7"
        stroke={color}
        strokeWidth="1.6"
        strokeDasharray={drawing.source === "agent" ? "3.5 2.5" : undefined}
        fill={drawing.source === "agent" ? "rgba(45,212,191,0.12)" : "rgba(244,143,177,0.12)"}
      />
    </svg>
  );
}

function NoteSwatch({ annotation }: { annotation: Annotation }) {
  const color = annotation.source === "agent" ? "#2dd4bf" : "#f48fb1";
  return (
    <svg className="obj-swatch" width="14" height="18" viewBox="0 0 14 18" fill="none" aria-hidden>
      <path
        d="M7 1.5a5 5 0 0 1 5 5C12 10 7 16 7 16S2 10 2 6.5a5 5 0 0 1 5-5Z"
        stroke={color}
        strokeWidth="1.5"
        fill={annotation.source === "agent" ? "rgba(45,212,191,0.12)" : "rgba(244,143,177,0.12)"}
      />
      <circle cx="7" cy="6.5" r="1.6" fill={color} />
    </svg>
  );
}

/**
 * The row's swatch. Three states, because there are three things a row can be:
 * a bundled feature (its category colour, the same six the legend shows), a
 * point of interest (neutral — the 18 POI categories have no colour on this
 * map, and inventing one here would put a swatch in the sidebar that matches
 * nothing on the canvas), or an id nothing has loaded (a hollow ring).
 */
function SelectedDot({ category }: { category: SelectedRow["category"] }) {
  if (category === null) return <span aria-hidden className="sel-dot unknown" />;
  if (!isFeatureCategory(category)) return <span aria-hidden className="sel-dot poi" />;
  return <span aria-hidden className="sel-dot" style={{ backgroundColor: CATEGORY_COLOR[category] }} />;
}

/** "8 selected · 1 shape · 1 note", or "quiet" when the map is untouched. */
function summarise(selection: number, shapes: number, notes: number): string {
  const parts: string[] = [];
  if (selection > 0) parts.push(`${selection} selected`);
  if (shapes > 0) parts.push(`${shapes} ${shapes === 1 ? "shape" : "shapes"}`);
  if (notes > 0) parts.push(`${notes} ${notes === 1 ? "note" : "notes"}`);
  return parts.length > 0 ? parts.join(" · ") : "quiet";
}

/**
 * What is on the map, in words: the selected features, the shapes and the
 * pinned notes, each labelled with who put it there and removable by hand.
 *
 * Agent chrome: it is mounted only once an agent is here (`page.tsx`). A
 * person browsing Taipei gets the map, not a lane listing what is on it — and
 * the two things this panel used to be the only home for have moved out to
 * where a human can reach them without an agent: the declarative `add_note`
 * form is now the Note popover (`Tools.tsx`, always in the DOM, because a
 * WebMCP client discovers it by finding `form[toolname]`), and a tapped
 * feature answers in `OnTheMapCard`.
 *
 * Below 921px it becomes the bottom sheet, where Contents shares the space
 * with the Activity feed (there is no room for the floating panel), and the
 * sheet opens on Activity — the pitch, or the calls, is the stronger first
 * read at that size.
 */
export function Inspector() {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"contents" | "activity">("activity");
  const features = useMapStore((s) => s.features);
  const tier2Features = useMapStore((s) => s.tier2Features);
  const selection = useMapStore((s) => s.selection);
  const drawings = useMapStore((s) => s.drawings);
  const annotations = useMapStore((s) => s.annotations);
  const removeDrawing = useMapStore((s) => s.removeDrawing);
  const removeAnnotation = useMapStore((s) => s.removeAnnotation);
  const activityCount = useMapStore((s) => selectActivity(s).length);
  const selectionSources = useMapStore((s) => s.selectionSources);
  const selectionAttributionExplicit = useMapStore((s) => s.selectionAttributionExplicit);
  const sheet = useMediaQuery(SHEET_TIER);
  const bodyRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => resolveSelection(features, selection, tier2Features),
    [features, selection, tier2Features],
  );
  // Who selected these, on the one surface that lists them all. Null — no tag —
  // whenever the answer is not the same for every row: a section head has room
  // for one word, and one word about a mixed list would be false for part of it.
  const claim = selectionClaim(selection, selectionSources, selectionAttributionExplicit);
  const quiet = rows.length === 0 && drawings.length === 0 && annotations.length === 0;

  // In the sheet, the feed shares the inspector's scroll container, so
  // resting at the newest call is this component's job.
  useEffect(() => {
    const body = bodyRef.current;
    // Nothing to rest at when no call has happened: the landing pitch reads
    // from the top like any other page.
    if (!body || !sheet || tab !== "activity" || activityCount === 0) return;
    body.scrollTop = body.scrollHeight;
  }, [sheet, tab, activityCount]);

  return (
    <aside className="inspector" data-testid="sidebar" data-open={open} data-tab={tab}>
      <div className="grab" aria-hidden />
      <div className="insp-head">
        <h2>On the map</h2>
        <span className="insp-sub" data-testid="sidebar-summary">
          {summarise(rows.length, drawings.length, annotations.length)}
        </span>
        <div className="insp-tabs" role="tablist" aria-label="Sheet view">
          <button
            type="button"
            role="tab"
            className={tab === "contents" ? "on" : ""}
            aria-selected={tab === "contents"}
            data-testid="sheet-tab-contents"
            onClick={() => setTab("contents")}
          >
            Contents
          </button>
          <button
            type="button"
            role="tab"
            className={tab === "activity" ? "on" : ""}
            aria-selected={tab === "activity"}
            data-testid="sheet-tab-activity"
            onClick={() => setTab("activity")}
          >
            Activity
          </button>
        </div>
        <button
          type="button"
          className="insp-hide"
          data-testid="sidebar-toggle"
          aria-expanded={open}
          aria-controls="sidebar-body"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      <div id="sidebar-body" className="insp-body" ref={bodyRef} hidden={!open}>
        <div className="view-contents">
          <section className="insp-section">
            <SectionHead
              icon={SelectedIcon}
              title="Selected"
              count={rows.length}
              testid="sidebar-selection-count"
              highlight
              tag={claim}
            />
            <ul data-testid="sidebar-selection">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="sel-row"
                  data-feature-id={row.id}
                  data-category={row.category ?? undefined}
                >
                  <SelectedDot category={row.category} />
                  <span className="sel-name" title={row.name}>
                    {row.name}
                  </span>
                  <span className="sel-cat">
                    {row.category ? categorySingular(row.category) : "not loaded"}
                    {row.sample ? " (sample)" : ""}
                  </span>
                </li>
              ))}
            </ul>
            {rows.length === 0 && (
              <div className="empty-note">
                Nothing selected. Click a feature, or ask the agent — “show me parks near Daan
                Station”.
              </div>
            )}
          </section>

          <section className="insp-section">
            <SectionHead
              icon={ShapesIcon}
              title="Shapes"
              count={drawings.length}
              testid="sidebar-drawings-count"
            />
            <ul data-testid="sidebar-drawings">
              {drawings.map((drawing) => (
                <li key={drawing.id} className="obj-card" data-drawing-id={drawing.id}>
                  <DrawingSwatch drawing={drawing} />
                  <div className="obj-main">
                    {drawing.label && <div className="obj-title">{drawing.label}</div>}
                    <div className="obj-meta">
                      {drawing.kind}
                      {drawing.radius_m ? ` · ${Math.round(drawing.radius_m)} m` : ""} ·{" "}
                      <Source source={drawing.source} /> · {drawing.id}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="obj-x"
                    data-testid="remove-drawing"
                    data-drawing-id={drawing.id}
                    aria-label={`Remove ${drawing.id}`}
                    // The shape leaves the store first, so the dissolve is
                    // played over a ghost of what was there — the artifact
                    // itself is already gone, which is the honest order.
                    onClick={() => {
                      if (removeDrawing(drawing.id)) {
                        emitHumanFx({
                          type: "delete",
                          geometry: drawing.geometry,
                          id: drawing.id,
                        });
                      }
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {drawings.length === 0 && (
              <div className="empty-note">
                No shapes yet. Draw a polygon by hand, or the agent can draw circles, polygons and
                routes.
              </div>
            )}
          </section>

          <section className="insp-section">
            <SectionHead
              icon={NotesIcon}
              title="Notes"
              count={annotations.length}
              testid="sidebar-annotations-count"
            />
            <ul data-testid="sidebar-annotations">
              {annotations.map((annotation) => (
                <li key={annotation.id} className="obj-card" data-annotation-id={annotation.id}>
                  <NoteSwatch annotation={annotation} />
                  <div className="obj-main">
                    <div className="obj-title">{annotation.note}</div>
                    <div className="obj-meta">
                      <Source source={annotation.source} /> · {annotation.id}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="obj-x"
                    data-testid="remove-annotation"
                    data-annotation-id={annotation.id}
                    aria-label={`Remove ${annotation.id}`}
                    onClick={() => {
                      if (removeAnnotation(annotation.id)) {
                        emitHumanFx({
                          type: "delete",
                          geometry: { type: "Point", coordinates: annotation.at },
                          id: annotation.id,
                        });
                      }
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {annotations.length === 0 && (
              <div className="empty-note">
                No notes pinned. Pin one below, or the agent pins what it finds — “quiet street,
                good light”.
              </div>
            )}
          </section>

          {quiet ? <TryAsking cards={ASK_CARDS} /> : null}
        </div>

        <div className="view-activity">
          <ActivityPanel />
        </div>
      </div>
    </aside>
  );
}
