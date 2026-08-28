# Screenshot agent vs WebMCP tools — one honest measurement (T-34)

Date: 2026-08-28 · Target: the production build at https://glassmap.clyeh.xyz · One run per arm per task, no statistical claims.

## Method

Both arms were driven by the same model (the project orchestrator) against the same deployed page.

- **Control arm ("screenshot agent")**: the page opened WITHOUT `?shim=1` — no tools. The agent was allowed only what a generic computer-use agent has: full-page screenshots, region crops, mouse clicks/drags/wheel, keyboard. Every UI action and every screenshot was counted.
- **WebMCP arm**: the same page with the tool surface; every `executeTool` call and its response size was counted.

Honesty notes, all biased **against** the WebMCP claim:
1. GlassMap's on-page state overlay shows live center/zoom/**bounds** numbers. The control agent used them for pixel↔metre math (centring, radius, distances). A typical web map gives a screenshot agent no such crutch.
2. GlassMap deliberately has no search box (that is the thesis), so the control arm navigates by pan/zoom only. On a map with a search box, task A's navigation would be easier — but tasks B and C would be unchanged.
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
| Cost | 3 screenshots (full + 2 region crops) | **1 tool call, 1,197 B returned** |
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
| B | `list_features_in_view` {parks} | 23 | 1,197 | ~5 ms |
| C | `describe_surroundings` {from, 800} | 43 | 2,771 | 9 ms |

Four calls, ~4.5 KB of structured output, zero screenshots, for all three tasks together. The control arm consumed 11 screenshots/crops (each one costing a multimodal model far more tokens than the entire WebMCP ledger) and still failed task B and approximated tasks A and C.

## Measurement caveats found along the way

- Tool calls issued in the same instant as `set_map_view` can observe the pre-flight `bounds` (the camera animates; the store records settled state at `moveend`). Agents chaining calls should let the flight settle — as a human watching the map naturally would. Flagged to tool-dev for a description note.
- Two early runs hit a transient `map not ready` within milliseconds of page load; waiting for the map's `ready` status (as any agent naturally does) avoids it.
