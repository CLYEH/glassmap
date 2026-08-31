# Screenshot agent vs WebMCP tools — one honest measurement (T-34)

Date: 2026-08-28 · Target: the production build at https://glassmap.clyeh.xyz · One run per arm per task, no statistical claims.

## Method

Both arms were driven by the same model (the project orchestrator) against the same deployed page.

- **Control arm ("screenshot agent")**: the page opened WITHOUT `?shim=1` — no tools. The agent was allowed only what a generic computer-use agent has: full-page screenshots, region crops, mouse clicks/drags/wheel, keyboard. Every UI action and every screenshot was counted.
- **WebMCP arm**: the same page with the tool surface; every `executeTool` call and its response size was counted.

Honesty notes, all biased **against** the WebMCP claim:
1. At the time of this run (2026-08-28), GlassMap's on-page state overlay showed live center/zoom/**bounds** numbers, and the control agent used them for pixel↔metre math (centring, radius, distances) — a crutch a typical web map does not give a screenshot agent. That overlay has since moved off-screen (the Smoked Glass redesign, PR #36): the visible camera chip now shows only center/zoom, and bounds live in an `aria-hidden` `.gm-machine` block meant for tools and tests, not a screenshot agent.
2. At the time of this run, GlassMap had no search box, so the control arm navigates by pan/zoom only. (A human search box shipped later, on 2026-08-31 — it searches the loaded data and the citywide name index, and does not change this measurement: the control agent drives the page by screenshots and clicks either way, and tasks B and C never depended on navigation.) On a map with a search box, task A's navigation would be easier — but tasks B and C would be unchanged.
3. The control agent knew Taipei's geography (where Daan Forest Park is on a citywide view). A model without that prior would need more exploration.

## Results

**Task A — "Move to Daan Park Station and mark an 800 m walking radius"**

| | Screenshot agent | WebMCP |
|---|---|---|
| Cost | 16 UI actions + 7 screenshots (~6 min) | **2 tool calls, 576 B returned (~1 s)** |
| Centring | 33 m off the station | exact (gazetteer) |
| The "circle" | 8-vertex polygon: −10.0 % area error inherent to the octagon, plus click precision; radius derived by hand from the overlay's bounds numbers | true 64-segment circle, area −0.16 % of π·800² |
| Could it be done at all? | only because the overlay leaks bounds numbers and the UI happens to have a polygon tool | `draw_shape` is one call |

**Task B — "List the parks in the current view, by name"**

| | Screenshot agent | WebMCP |
|---|---|---|
| Cost | 3 screenshots (full + 2 region crops) | **1 tool call, 1,197 B returned**\* |
| Result | **1 of 11** parks nameable — and only by inference from an MRT station label; the other 10 render as unlabeled green polygons at this zoom | all **11** parks with name, distance and compass direction |
| Path to parity | zoom-and-pan grid over the viewport hoping the basemap labels appear (dozens of screenshots, not guaranteed — smaller parks are never labelled) | — |

**Task C — "Which direction and how far is Daan Forest Park from the station?"**

| | Screenshot agent | WebMCP |
|---|---|---|
| Cost | 1 screenshot + pixel/overlay arithmetic | **1 tool call** (`describe_surroundings`, 2,771 B for the full direction-grouped answer) |
| Answer | ≈ 426 m S (park centre guessed from pixels) | **355 m S** (computed from feature geometry) |
| Error | +20 % distance; correct direction | ground truth |

## Raw WebMCP ledger

| task | call | input B | output B | latency |
|---|---|---|---|---|
| A | `set_map_view` {place, zoom} | 39 | 216 | 7 ms |
| A | `draw_shape` circle 800 m | 83 | 360 | 6 ms |
| B | `list_features_in_view` {parks} | 23 | 1,197\* | ~5 ms |
| C | `describe_surroundings` {from, 800} | 43 | 2,771 | 9 ms |

Four calls, ~4.5 KB of structured output, zero screenshots, for all three tasks together. The control arm consumed 11 screenshots/crops (each one costing a multimodal model far more tokens than the entire WebMCP ledger) and still failed task B and approximated tasks A and C.

\* **Footnote added 2026-08-30, measurement unchanged.** `list_features_in_view` and `find_features` did not echo their query `origin` back to the caller on 2026-08-28, when 1,197 B was measured. T-70 (PR #52, merged 2026-08-30) added that echo — an `{ origin: { lng, lat } }` field on every answer, plus `radius_m` on `find_features` when the search was bounded — so both tools' responses are larger today than on the measurement date. For a call shaped like task B's, the added `origin` field alone costs ~43 B (`,"origin":{"lng":121.53528,"lat":25.03356}` is 42 B for that specific coordinate pair; exact cost varies by a byte or two with the digit count of the coordinates). Today's actual response for the same call is therefore closer to **1,240 B**, not 1,197 B. The 2026-08-28 number above is left as measured — re-running the live comparison is out of this task's scope — and the WebMCP arm's real margin over the screenshot arm is if anything larger now than what this table shows, never smaller.

## Measurement caveats found along the way

- Tool calls issued in the same instant as `set_map_view` can observe the pre-flight `bounds` (the camera animates and the store records settled state at `moveend` — except when the basemap style never loaded, where it jumps and settles synchronously instead, fixed in PR #39). Agents chaining calls should let the flight settle — as a human watching the map naturally would. Flagged to tool-dev for a description note.
- Two early runs hit a transient `map not ready` within milliseconds of page load; waiting for the map's `ready` status (as any agent naturally does) avoids it.
