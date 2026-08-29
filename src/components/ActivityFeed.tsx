"use client";

import { useEffect, useRef, useState } from "react";
import { useMapStore } from "@/lib/store/map-store";
import {
  callCountLabel,
  formatCallTime,
  groupActivity,
  selectActivity,
  splitSummary,
  type ActivityEntry,
  type ActivityRow,
} from "./activity-model";
import { SHEET_ASK_CARDS, TryAsking } from "./TryAsking";
import { TOOL_ROSTER } from "./tool-roster";
import { MID_TIER, SHEET_TIER, useMediaQuery } from "./useMediaQuery";

/** How many tools this page declares; the badge counts the same thing. */
function useDeclaredToolCount(): number {
  return useMapStore((s) => s.webmcp?.toolCount) ?? TOOL_ROSTER.length;
}

function Call({ row }: { row: ActivityRow }) {
  const { entry, folded } = row;
  const kind = !entry.ok ? "failed" : entry.readOnly ? "read" : "write";
  return (
    <li
      className={`call ${kind}`}
      data-testid="activity-call"
      data-tool={entry.tool}
      data-folded={folded > 1 ? folded : undefined}
    >
      <span aria-hidden className="dot" />
      <div className="call-head">
        <code className="tool">{entry.tool}</code>
        {folded > 1 ? (
          <span className="call-fold" title={`${folded} read calls in a row; the newest is shown`}>
            ×{folded}
          </span>
        ) : null}
        <span className="call-time">{formatCallTime(entry.at)}</span>
      </div>
      <p className="call-sum">
        {splitSummary(entry.summary, entry.refIds).map((segment, index) =>
          segment.code ? (
            <code key={index}>{segment.text}</code>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </p>
    </li>
  );
}

/**
 * The calls, oldest first, with the waiting row underneath. The order is the
 * store's own: a feed that reordered calls to tell a better story would be
 * lying about what the agent did.
 */
export function CallList({ activity }: { activity: readonly ActivityEntry[] }) {
  return (
    <ol className="feed-list" data-testid="activity-list">
      {groupActivity(activity).map((row) => (
        <Call key={row.entry.seq} row={row} />
      ))}
      <li className="call wait">
        <span aria-hidden className="dot" />
        <p className="wait-sum">Listening — waiting for the next call…</p>
      </li>
    </ol>
  );
}

/** What the feed says before any agent has connected. */
function LandingPitch({ cards }: { cards?: boolean }) {
  return (
    <>
      <p className="fe-title">This map is readable.</p>
      <p className="fe-copy">
        Connect an agent — ChatGPT desktop, pointed at this page — and it sees the map as data,
        not pixels. Every tool call it makes lands here, and on the map, as it works.
      </p>
      {cards ? <TryAsking cards={SHEET_ASK_CARDS} /> : null}
      <div className="fe-tools" data-testid="tool-roster">
        {TOOL_ROSTER.map((tool) => (
          <code key={tool}>{tool}</code>
        ))}
      </div>
    </>
  );
}

/**
 * The hero: every tool call, as it happens, over the map it changed.
 *
 * Write calls carry a filled teal dot, reads a hollow one, so "what did the
 * agent actually change" is answerable at a glance. The panel rests at the
 * newest call and can be collapsed to a pill — on the mid tier a busy feed
 * starts collapsed, because there the map itself is the scarce thing.
 */
export function ActivityFeed() {
  const activity = useMapStore(selectActivity);
  const toolCount = useDeclaredToolCount();
  const midTier = useMediaQuery(MID_TIER);
  const sheet = useMediaQuery(SHEET_TIER);
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const busy = activity.length > 0;
  const collapsed = userToggled ?? (busy && midTier);
  const last = activity[activity.length - 1];

  // Live feeds rest at the newest call.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [activity.length, collapsed]);

  // The sheet tier renders the feed inside the inspector instead. CSS hides
  // this panel there anyway; not rendering it keeps one feed in the DOM, so a
  // row is never two elements with the same test id.
  if (sheet) return null;

  return (
    <section
      className={`feed glass${collapsed ? " collapsed" : ""}${busy ? " has-calls" : ""}`}
      aria-label="Agent activity"
      data-testid="activity-feed"
      data-collapsed={collapsed}
    >
      <div className="feed-head">
        <span aria-hidden className="pulse" />
        <h2>Agent activity</h2>
        <span className="feed-mini">
          {busy && last ? (
            <>
              <code className="tool">{last.tool}</code>
              <span className="feed-mini-n">{callCountLabel(activity.length)}</span>
            </>
          ) : (
            <span className="feed-mini-n">{toolCount} tools ready</span>
          )}
        </span>
        {busy ? (
          <span className="feed-count" data-testid="activity-count">
            {callCountLabel(activity.length)}
          </span>
        ) : null}
        <button
          type="button"
          className="feed-toggle"
          data-testid="activity-toggle"
          aria-expanded={!collapsed}
          aria-label="Collapse or expand the activity feed"
          onClick={() => setUserToggled(!collapsed)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M3.5 8.5 7 5l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {busy ? (
        <div className="feed-body" ref={bodyRef}>
          <CallList activity={activity} />
        </div>
      ) : (
        <div className="feed-empty" data-testid="activity-pitch">
          <LandingPitch />
        </div>
      )}
    </section>
  );
}

/**
 * The sheet tier's Activity tab: the same feed, in the bottom sheet, where the
 * floating panel has no room. At landing it carries the pitch and the two
 * strongest prompts — showing calls that never happened would be a lie, and
 * dead space would waste the one screen a phone has.
 */
export function ActivityPanel() {
  const activity = useMapStore(selectActivity);
  const sheet = useMediaQuery(SHEET_TIER);
  // Above 920px the floating panel is the feed; see `ActivityFeed`.
  if (!sheet) return null;
  if (activity.length === 0) {
    return (
      <div data-testid="activity-pitch">
        <LandingPitch cards />
      </div>
    );
  }
  return <CallList activity={activity} />;
}

/** Above the sheet: the last call, so the map still reports what just happened. */
export function ActivityTicker() {
  const activity = useMapStore(selectActivity);
  const toolCount = useDeclaredToolCount();
  const last = activity[activity.length - 1];

  return (
    <div className="ticker glass" data-testid="activity-ticker">
      <span aria-hidden className="pulse" />
      {last ? (
        <span className="ticker-row">
          <code className="tool">{last.tool}</code>
          <span className="ticker-sum">{last.summary}</span>
          <span className="ticker-n">{callCountLabel(activity.length)}</span>
        </span>
      ) : (
        <span className="ticker-row">
          <span className="ticker-sum">Waiting for an agent — the map is readable</span>
          <span className="ticker-n">{toolCount} tools</span>
        </span>
      )}
    </div>
  );
}
