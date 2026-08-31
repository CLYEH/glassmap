"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useMapStore } from "@/lib/store/map-store";
import { callCountLabel } from "./activity-model";
import { unseenCalls, usePanelStore } from "./panel-store";
import { ASK_CARDS } from "./TryAsking";
import { useAwakenMode } from "./useAwakenMode";

/** Per session, not per browser: a new tab is a new visitor being told once. */
const KEY = "glassmap:whisper-dismissed";

/**
 * Whether this session has already been told. Read through
 * `useSyncExternalStore` rather than an effect, for two reasons: the first
 * server render has no `sessionStorage` (the server snapshot is always "not
 * dismissed", and React swaps in the real answer after hydration), and the
 * React 19 rules this repo lints against forbid the `setState`-in-an-effect
 * that the naive version needs.
 *
 * `null` is "not read yet" — the read is done once, lazily, on the client.
 */
let dismissed: boolean | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): boolean {
  if (dismissed === null) {
    try {
      dismissed = window.sessionStorage.getItem(KEY) === "1";
    } catch {
      // Private mode, a blocked third-party context, a storage quota: the
      // whisper is worth showing at the cost of showing it twice, never worth
      // an exception on the landing page.
      dismissed = false;
    }
  }
  return dismissed;
}

function dismiss(): void {
  dismissed = true;
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // Same trade as above: it stays dismissed for this page's lifetime either
    // way, because the module variable is the thing the component reads.
  }
  for (const listener of listeners) listener();
}

/**
 * The quietest possible statement of what this map is: a spark in the corner,
 * and — once per session — six words beside it.
 *
 * The repositioning (BRIEF item 3) says the page must be fully operable by a
 * human with no agent, and that the agent chrome must not be on screen until an
 * agent is. That leaves one honest problem: a visitor who never learns the page
 * is agent-readable never asks an agent to read it. This is the whole answer —
 * a whisper, dismissible, that says what is true and takes no room. Clicking
 * the spark opens the same sentence at length, with a prompt to try.
 *
 * It is rendered only in human chrome (`page.tsx`); once an agent is here the
 * badge says so, and a page telling you it *could* be read while it is being
 * read is noise.
 *
 * ## The way in, and the way back (T-93)
 *
 * The spark is also the collapsed button for the agent chrome itself. Its card
 * carries the one control that opens that chrome by hand — the design's own
 * answer to "where does a visitor find this without an agent", and the reason
 * no new permanent furniture landed on the human-first map.
 *
 * When the chrome has been closed by hand over an agent that is still working,
 * this same spark is what is left of it, and it says so: it pulses, and it
 * carries the exact number of calls that have landed unseen — `activitySeq`
 * arithmetic (`unseenCalls`), never a count of feed rows, which the 50-row cap
 * and read-folding both make a lie. The count is the only claim made here about
 * an agent, and it is made of calls this page really recorded.
 */
export function AgentWhisper() {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const [open, setOpen] = useState(false);
  const mode = useAwakenMode();
  const panel = usePanelStore((s) => s.panel);
  const seqAtClose = usePanelStore((s) => s.seqAtClose);
  const openChrome = usePanelStore((s) => s.open);
  const activitySeq = useMapStore((s) => s.activitySeq);
  const closed = panel === "closed";
  const waking = mode === "waking";
  /**
   * The chrome is folded away and there is really something behind it. The
   * pulse is a claim about the machine (`awake` — an agent acted on this page),
   * never about the panel: closing a chrome nobody opened for you leaves a
   * plain spark, because nothing is waiting.
   */
  const waiting = closed && mode === "awake";
  const unseen = waiting ? unseenCalls(activitySeq, seqAtClose) : 0;

  const onSpark = useCallback(() => {
    dismiss();
    setOpen((value) => !value);
  }, []);

  // Opening the chrome closes the card that offered it: the answer to "what
  // does an agent see" is now the whole page behind it, and a card left open
  // over the feed would be covering the thing it just asked you to look at.
  const onOpenChrome = useCallback(() => {
    setOpen(false);
    openChrome();
  }, [openChrome]);

  return (
    <div
      className="spark-wrap"
      data-testid="agent-whisper-zone"
      data-open={open}
      data-closed-chrome={closed || undefined}
    >
      {open ? (
        <div className="spark-card lg deep" data-testid="agent-card">
          <h4>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
              <path d="M7 0l1.6 5.4L14 7l-5.4 1.6L7 14 5.4 8.6 0 7l5.4-1.6z" />
            </svg>
            This map is readable
          </h4>
          <p>
            Point an AI agent — ChatGPT desktop, at this page — and it sees the map as data, not
            pixels. The moment it acts, the map wakes: you will see every move it makes, right
            here.
          </p>
          <div className="spark-try">
            <b>Try asking</b>
            {ASK_CARDS[0].question}
          </div>
          {/* The way in. Inert for the 1.8s of the story (design ruling 4):
              the skip listener answers any keydown, so a focused toggle and
              the transition would otherwise both fire from one press. */}
          <button
            type="button"
            className="spark-open"
            data-testid="chrome-open"
            disabled={waking}
            aria-disabled={waking}
            onClick={onOpenChrome}
          >
            {mode === "awake" ? "Show the agent view" : "Preview what an agent sees"}
          </button>
        </div>
      ) : null}

      {/* Not over a chrome that was closed by hand: "also readable by AI
          agents" is a landing invitation, and one has already been reading.
          It would also land in the same corner slot as the unseen count. */}
      {!hidden && !open && !waiting ? (
        <div className="spark-callout lg lens" data-testid="agent-whisper">
          Also readable by AI agents
          <button
            type="button"
            className="x"
            data-testid="agent-whisper-dismiss"
            aria-label="Dismiss"
            onClick={dismiss}
          >
            ×
          </button>
        </div>
      ) : null}

      {/* What a hand-closed agent chrome is reduced to: a number, and it is the
          exact one. Withheld at zero — a chip saying "0 calls" over a folded
          feed would be furniture, and the pulse already says the chrome is
          there to come back to. */}
      {waiting && unseen > 0 ? (
        <span className="spark-unseen" data-testid="chrome-unseen">
          {callCountLabel(unseen)}
        </span>
      ) : null}

      <button
        type="button"
        className={`spark lg lens${waiting ? " waiting" : ""}`}
        data-testid="agent-spark"
        data-waiting={waiting || undefined}
        aria-expanded={open}
        aria-label={waiting ? "Show the agent view" : "About agents"}
        onClick={onSpark}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
          <g transform="rotate(14 9 9)">
            <path d="M9 1.4 L10.7 7.3 L16.6 9 L10.7 10.7 L9 16.6 L7.3 10.7 L1.4 9 L7.3 7.3 Z" />
          </g>
        </svg>
      </button>

      {/* The feed's own "live" ring, on the button the feed folded into. Its
          own element because the glass material has already spent `::after` on
          the edge lens (`.lg.lens::after`, globals.css). */}
      {waiting ? <span aria-hidden className="spark-ring" /> : null}
    </div>
  );
}
