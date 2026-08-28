#!/usr/bin/env bash
# ship-pr.sh — push a branch, open (or reuse) its PR, wait for ALL required
# check runs, merge, verify, and clean up. Encodes hard-won lessons as code
# instead of prompt text (see CONTRIBUTING.md):
#
#   * a heredoc ends an && chain, so this script exists instead of ad-hoc chains
#   * an in-progress CheckRun has conclusion "" (empty string), not null
#   * the same head gets a push run AND a pull_request run — wait for all
#   * strict branch protection requires the base's tip in the head's history
#     (use --merge-back when promoting develop to main)
#   * `git worktree remove --force` leaves node_modules junctions behind on
#     Windows — fall back to rm -rf, then PowerShell
#   * never trust the chain's exit code as proof of a merge: re-read the base
#
# Usage:
#   scripts/ship-pr.sh --head <branch> --title <t> --body-file <f> \
#     [--base develop] [--strategy squash|merge] [--repo-root <dir>] \
#     [--worktree <dir>] [--merge-back] [--verify-cmd <shell command>] \
#     [--timeout-loops 40] [--poll-seconds 15]
#
# The PR body comes from a FILE (never inline) so the calling chain needs no
# heredoc. If a PR for the head already exists, it is reused; title/body are
# then left untouched. --verify-cmd runs with cwd = repo root AFTER the merged
# base is pulled; its failure fails the script loudly (the merge has already
# happened — the point is to refuse to report success on an unverified claim).
set -euo pipefail

BASE="develop"
STRATEGY="squash"
ROOT="$(pwd)"
HEAD="" TITLE="" BODY_FILE="" WORKTREE="" VERIFY_CMD="" MERGE_BACK=0
LOOPS=40 POLL=15

while [ $# -gt 0 ]; do
  case "$1" in
    --head) HEAD="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --body-file) BODY_FILE="$2"; shift 2 ;;
    --strategy) STRATEGY="$2"; shift 2 ;;
    --repo-root) ROOT="$2"; shift 2 ;;
    --worktree) WORKTREE="$2"; shift 2 ;;
    --merge-back) MERGE_BACK=1; shift ;;
    --verify-cmd) VERIFY_CMD="$2"; shift 2 ;;
    --timeout-loops) LOOPS="$2"; shift 2 ;;
    --poll-seconds) POLL="$2"; shift 2 ;;
    *) echo "ship-pr: unknown argument $1" >&2; exit 2 ;;
  esac
done

[ -n "$HEAD" ] || { echo "ship-pr: --head is required" >&2; exit 2; }
git -C "$ROOT" rev-parse --git-dir >/dev/null

# --merge-back: bring the base's tip (e.g. an old merge commit on main) into
# the head's history so strict protection does not refuse the merge.
if [ "$MERGE_BACK" -eq 1 ]; then
  git -C "$ROOT" fetch -q origin "$BASE"
  git -C "$ROOT" switch -q "$HEAD"
  git -C "$ROOT" merge --no-edit "origin/$BASE"
  git -C "$ROOT" push -q origin "$HEAD"
fi

# Push the head (worktree-agnostic: the ref exists repo-wide).
git -C "$ROOT" push -q -u origin "$HEAD"

# Open the PR, or reuse an existing one for this head.
PR="$(gh pr list --head "$HEAD" --base "$BASE" --json number -q '.[0].number' || true)"
if [ -z "$PR" ]; then
  [ -n "$TITLE" ] && [ -n "$BODY_FILE" ] || { echo "ship-pr: no existing PR; --title and --body-file required" >&2; exit 2; }
  gh pr create --base "$BASE" --head "$HEAD" --title "$TITLE" --body-file "$BODY_FILE" >/dev/null
  PR="$(gh pr list --head "$HEAD" --base "$BASE" --json number -q '.[0].number')"
fi
echo "ship-pr: PR #$PR ($HEAD -> $BASE)"

# Wait until every required "check" run has a real conclusion.
# In-progress CheckRuns report conclusion "" — treat empty as pending.
CONCLUSIONS=""
for _ in $(seq 1 "$LOOPS"); do
  CONCLUSIONS="$(gh pr view "$PR" --json statusCheckRollup -q \
    '[.statusCheckRollup[] | select((.name // .context)=="check")
      | (if (.conclusion // "") == "" then "PENDING" else .conclusion end)]
     | unique | join(",")')"
  if [ -n "$CONCLUSIONS" ] && ! printf '%s' "$CONCLUSIONS" | grep -q PENDING; then break; fi
  sleep "$POLL"
done
echo "ship-pr: check conclusions = ${CONCLUSIONS:-<none>}"
[ "$CONCLUSIONS" = "SUCCESS" ] || { echo "ship-pr: refusing to merge (checks: ${CONCLUSIONS:-none appeared})" >&2; exit 1; }

# No --delete-branch: gh would try to check out the default branch locally to
# delete the head, which fails when the head lives in a worktree and the
# default branch is checked out elsewhere ("already used by worktree") — and
# that local failure masks a REMOTE merge that already succeeded. Merge only;
# branches are deleted explicitly below, after the merge is fact-checked.
case "$STRATEGY" in
  squash) gh pr merge "$PR" --squash ;;
  merge)  gh pr merge "$PR" --merge ;;
  *) echo "ship-pr: unknown strategy $STRATEGY" >&2; exit 2 ;;
esac

# Fact-check the merge instead of trusting exit codes.
git -C "$ROOT" fetch -q origin "$BASE"
STATE="$(gh pr view "$PR" --json state -q .state)"
[ "$STATE" = "MERGED" ] || { echo "ship-pr: PR #$PR state is $STATE, not MERGED" >&2; exit 1; }
echo "ship-pr: merged; origin/$BASE = $(git -C "$ROOT" log --oneline -1 "origin/$BASE")"

# Clean up the worktree; junction leftovers need escalating removal.
if [ -n "$WORKTREE" ]; then
  git -C "$ROOT" worktree remove --force "$WORKTREE" 2>/dev/null || true
  [ -d "$WORKTREE" ] && rm -rf "$WORKTREE" 2>/dev/null || true
  if [ -d "$WORKTREE" ]; then
    powershell.exe -NoProfile -Command "Remove-Item -Recurse -Force -LiteralPath '$WORKTREE'" || true
  fi
  git -C "$ROOT" worktree prune
  [ -d "$WORKTREE" ] && echo "ship-pr: warning — $WORKTREE still exists" >&2 || true
fi

# Delete the head branch explicitly (remote first, then local) — but never
# when it is a long-lived branch (a promote's head is the integration branch).
if [ "$HEAD" != "develop" ] && [ "$HEAD" != "main" ]; then
  git -C "$ROOT" push -q origin --delete "$HEAD" 2>/dev/null || true
  git -C "$ROOT" branch -D "$HEAD" 2>/dev/null || true
fi

# Sync the local base branch (only if the main checkout is on it or can switch).
git -C "$ROOT" switch -q "$BASE"
git -C "$ROOT" pull -q

if [ -n "$VERIFY_CMD" ]; then
  echo "ship-pr: running verify command"
  ( cd "$ROOT" && eval "$VERIFY_CMD" ) || { echo "ship-pr: VERIFY FAILED — the merge happened but the claim is unproven" >&2; exit 1; }
  echo "ship-pr: verify passed"
fi

echo "ship-pr: done"
