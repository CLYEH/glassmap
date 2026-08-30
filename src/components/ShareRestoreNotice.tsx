"use client";

import { useMapStore } from "@/lib/store/map-store";

/**
 * The categories a shared link declared that this page could not load.
 *
 * A link is a promise to reproduce the sender's map, and the one failure that
 * would otherwise be invisible is a category file that never arrived: the
 * camera and the shapes restore, the selected places belonging to that category
 * simply are not there, and nothing on screen says why. The tool layer already
 * refuses to answer "no cafes nearby" when the truth is "the cafe file did not
 * arrive" (`store/tier2.ts`); this is the same honesty for the person looking
 * at the page.
 *
 * One quiet line per failed category, no colour and no icon: nothing here is
 * actionable beyond reloading, and a modal or a red banner would be louder than
 * the loss. Absent entirely while the list is empty, so the ordinary case is
 * byte-identical to a page without it — and the exact loader sentence rides
 * along in `title` for anyone who wants the reason.
 */
export function ShareRestoreNotice() {
  const failures = useMapStore((s) => s.tier2RestoreFailures);
  if (failures.length === 0) return null;

  return (
    <div className="share-restore glass" data-testid="share-restore">
      {failures.map((failure) => (
        <span
          key={failure.category}
          data-testid="share-restore-failure"
          data-category={failure.category}
          title={failure.error}
        >
          couldn&apos;t load <span className="share-restore-cat">{failure.category}</span> for this
          link
        </span>
      ))}
    </div>
  );
}
