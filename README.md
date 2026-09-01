# GlassMap

**An agent-native web map.** GlassMap uses [WebMCP](https://webmachinelearning.github.io/webmcp/) to turn the map canvas from a black box into a semantic surface: an AI agent can read the current view, find features, move the camera, draw shapes and annotate the map **without taking a single screenshot** — and the human watches it happen on the same map.

> Live: **https://glassmap.clyeh.xyz** · Built for [The WebMCP Challenge](https://webmcp.devpost.com/) (Aug 25 – Sep 3, 2026).
> **Status:** all fourteen planned tools are implemented and unit-tested — `get_map_state`, `set_map_view`, `list_features_in_view`, `find_features`, `select_features`, `draw_shape`, `plan_route`, `annotate`, `remove_from_map`, `describe_surroundings`, `compare_areas`, `measure`, `get_place_details`, `get_share_link` — plus one declarative form, `add_note`: fifteen in total, the number the on-page WebMCP badge counts. (`set_layers` was cut on 2026-08-29 — the demo script never needed layer toggling, so it was never built.) They act on 24 categories of data — six bundled Taipei datasets (2,063 features, always in memory; five are real OpenStreetMap data, the sixth is 25 fabricated sample listings, not OSM) plus 18 more real OpenStreetMap point-of-interest categories (31,069 features, loaded lazily per category on first use). The redesigned "Smoked Glass" interface and the agent-presence FX layer (every tool call renders a brief, self-clearing effect on the map) are both live. The page itself opens as a plain map with no agent chrome; the first live tool call wakes the inspector panel and the "Agent activity" feed into view, and a human can also open or close that view by hand at any time. Remaining: the demo video and the submission freeze.

## Why "Glass"

A web map is a WebGL canvas. To a browser agent every station, park and pin is just pixels:

- To *see*, it must screenshot and let a multimodal model guess what the markers are.
- To *act*, it must click at coordinates that stop being valid the moment the zoom changes.
- To *draw a polygon*, *measure a distance* or *select every park in view*, it has essentially no way at all.

Maps are the largest "DOM without semantics" surface on the web. WebMCP fills exactly that gap: the page exposes map state, features and actions as structured tools, so the agent never has to look at pixels. The black box becomes **glass** — the agent sees straight through the canvas to the data underneath.

The same opacity that blocks agents also blocks screen readers, so the read-only tools double as a semantic layer for people who cannot see the map. We call this *agent-mediated map access*; it is not a WCAG or accessibility-compliance claim.

`describe_surroundings` is the clearest example. It names the district a point is in — falling back to the nearest district boundary within 300 m when the point sits in a seam between two independently simplified polygons, and naming none rather than guessing beyond that — then lists nearby features grouped into up to eight compass directions, nearest first, each with a distance in metres and a feature id an agent can act on next (`select_features`, `set_map_view`). When more features match than the tool describes, it says so instead of staying quiet: `total` is how many are within `radius_m`, `returned` is how many were actually listed (at most 30) — so a wider radius is never implied to reveal features that were simply cut off.

## What an agent can do

| You say | Without WebMCP | With GlassMap |
|---|---|---|
| "Move the map to Daan Park Station" | screenshot → find search box → type → screenshot → maybe click the wrong result | `set_map_view({ place: "Daan Park Station" })` |
| "Which parks are in view?" | screenshot → guess that green blobs are parks → can't read names | `list_features_in_view({ categories: ["park"] })` |
| "Circle an 800 m walk from the station" | nearly impossible: compute a pixel radius at the right zoom, then drag | `draw_shape({ type: "circle", center: …, radius_m: 800 })` |
| "What's inside the area I just drew?" | impossible — the agent cannot see vector geometry | `find_features({ within: "drawing:1" })` |
| "How big is the circle I just drew?" | impossible — a screenshot has no scale, so area has to be guessed from pixels | `measure({ target: "drawing:1" })` → `{ area_m2, perimeter_m }` |
| "Is Daan or Zhongshan better connected?" | screenshot both, eyeball the pins on each, guess which side has more | `compare_areas({ a: "Daan Park Station", b: "Zhongshan Station" })` → per-category counts and nearest match on each side |
| "I can't see the map. Where's the nearest park?" | impossible | `describe_surroundings()` → nearest features grouped by direction, each with a name, distance in metres and id |

## Screenshots vs. tools, measured

One run per arm, per task, measured on 2026-08-28 against the production build of that date — no statistical claims. The tool output has changed since (`docs/comparison.md`'s dated footnote quantifies one such change), so read the byte counts below as of that date, not today's; full method and every other honesty caveat are in [`docs/comparison.md`](./docs/comparison.md).

| Task | Screenshot agent | WebMCP |
|---|---|---|
| Move to a station and mark an 800 m walking radius | 16 UI actions + 7 screenshots (~6 min); circle approximated as an 8-vertex polygon; centring 33 m off | **2 tool calls, 576 B (~1 s)**; exact centre (gazetteer); a true circle |
| List the parks in the current view, by name | 3 screenshots (full + 2 crops); only **1 of 11** parks nameable — the rest are unlabeled green polygons at this zoom | **1 tool call, ~1.2 KB**; all **11** parks, each with a name, distance and compass direction |
| How far and which direction to a named park | 1 screenshot + pixel/overlay arithmetic; ≈426 m guessed from pixels, +20% error (correct direction) | **1 tool call**, 2,771 B; **355 m**, computed from feature geometry (ground truth) |

Four tool calls, ~4.5 KB of structured output, zero screenshots, across all three tasks — against 11 screenshots/crops on the control side, which still failed the second task outright and approximated the other two.

## Tools

Three layers, fourteen tools implemented. `set_layers` was cut before build — never built, not counted here (see below). Every write tool returns the new map state so the agent never needs a follow-up read.

```
Perceive (read-only, replaces screenshots)   Navigate (camera only)     Act (page state, no server)
├─ get_map_state ✅                          ├─ set_map_view ✅         ├─ draw_shape ✅
│                                            └─ set_layers (cut)        ├─ plan_route ✅
├─ list_features_in_view ✅                                             ├─ select_features ✅
├─ find_features ✅                                                     ├─ annotate ✅
├─ describe_surroundings ✅                                             ├─ remove_from_map ✅
│                                                                       └─ get_share_link ✅
├─ measure ✅
├─ compare_areas ✅
└─ get_place_details ✅
```

✅ = implemented and covered by unit tests. `set_layers` was cut on 2026-08-29 — not planned, not pending, simply not built once the demo script turned out not to need layer toggling.

| Tool | What it does | Key inputs |
|---|---|---|
| `get_map_state` | Reads the camera, visible bounds, feature count, selection, drawings and annotations in one call — the read that used to require a screenshot. | *(none)* |
| `set_map_view` | Moves the camera: by exact `center`/`zoom`/`bearing`/`pitch`, by `feature_id` or `place` name (defaulting to a zoom *floor* — flying to a place never zooms you out; pass `zoom` to override, in either direction), or by `fit` — a drawing or feature id framed whole, with the same math the inspector's row clicks use. An ambiguous `place` does not move the map — it returns candidates with distances instead. | `place`, `feature_id`, `fit`, `center`, `zoom`, `bearing`, `pitch` |
| `list_features_in_view` | Lists loaded features whose bounds overlap the current view, nearest-first, each with distance in metres and an 8-point compass direction from the view centre; `query` searches within the view over the same five fields `find_features` matches (name, English name, brand, cuisine, address). | `query`, `categories`, `limit` |
| `find_features` | Searches every loaded feature, not just what's visible, by a substring of its name, English name, brand, cuisine or address, by category, by distance from a place/feature/coordinate, and by whether it's inside a shape on the map — including one a human drew by hand; a query that matches places in categories not yet loaded says so under `unloaded_matches`. | `query`, `categories`, `near`, `radius_m`, `within`, `limit` |
| `select_features` | Highlights features on the map and in the inspector's Selected list, by explicit ids or the same `query`/`near`/`radius_m`/`categories`/`within` filter `find_features` accepts — but selects every match, not just the first `limit`. | `ids` or filter, `within`, `replace` |
| `draw_shape` | Draws a circle, polygon or line on the map so the human can see the area being discussed; returns its area (circle/polygon) or length (line) and a `drawing:<n>` id. | `type`, `center`+`radius_m` (circle) or `coordinates` (polygon/line), `label` |
| `plan_route` | Plans a walking route between two places via the keyless FOSSGIS OSRM service (OpenStreetMap data) and draws it as a line the human can see; returns the drawing id, `distance_m` and `duration_s`, says `simplified: true` when the geometry was thinned to fit, and fails honestly — never a fake route — when the service cannot answer. The one tool that talks to an external service; attribution renders on the page. | `from`, `to`, `label` |
| `annotate` | Pins a short note to a place on the map, so the human sees what was found where it was found. | `at`, `note`, `icon` |
| `remove_from_map` | Takes things off the map by id: the agent's own drawings and notes are removed, named features leave the selection, and a shape or note the *human* made is refused per-id — the person who drew it can tap it and press Remove. Every id in the batch is accounted for in exactly one bucket; removal is permanent, with no undo. | `ids` (drawing/annotation/feature ids) |
| `describe_surroundings` | Describes what's around a point the way a person would say it out loud: the district, then nearby features grouped by compass direction, nearest first, each with a distance and an id. | `from`, `radius_m` |
| `compare_areas` | Compares two places in one call: per-category counts of what's within `radius_m` of each, plus the nearest match of each category on each side; if a place name doesn't resolve, the error names which side (`a` or `b`) failed. | `a`, `b`, `radius_m`, `categories` |
| `measure` | Measures one drawing or loaded feature: area and perimeter for a circle or polygon, length for a line. A point has no extent and is refused, with a pointer to `find_features` for distances instead. | `target` |
| `get_place_details` | Everything the page knows about one place — address, phone, website, opening hours, wheelchair (as OpenStreetMap reports it, not a verified accessibility claim) and category-specific facts — for the questions a list answer is too lean for. Fields exist only where OSM has them; absent means absent. | `id` |
| `get_share_link` | Builds a link that reproduces this map for whoever opens it — camera, selection, every drawing and every note, encoded in the URL itself, nothing uploaded. Returns `{ url, bytes }`; a map too large to fit in a URL (over 8 KB) is refused with an error naming what to remove. | *(none)* |

`within: "drawing:<n>"` on `find_features` and `select_features` is the read half of the collaborative loop: any circle or polygon on the map — agent-drawn or hand-drawn by a human — becomes something an agent can query by id, not just something rendered on screen. (A line has no inside, so `within` does not apply to it.)

Design rules the tool layer follows:

- Every write tool (`set_map_view`, `select_features`, `draw_shape`, `annotate`, `plan_route`, `remove_from_map`) returns the full new map state, so the agent never needs a follow-up read.
- Read-only tools carry `readOnlyHint: true` so clients can skip confirmation prompts.
- Output that contains OpenStreetMap or user-entered text carries `untrustedContentHint: true`.
- Responses are small on purpose: `limit` defaults to 20, coordinates are rounded to 5 decimals, geometry is returned by id rather than inline.
- Bad input returns a structured `{ error }` instead of throwing, so the agent can recover.
- No `alert` / `confirm` / `prompt` anywhere — modal dialogs freeze agents.

## City-wide breadth

The six bundled datasets above (2,063 features) are always in memory. Beyond them, GlassMap knows about 18 more OpenStreetMap point-of-interest categories — `restaurant`, `cafe`, `pharmacy`, `hotel`, `bank` and 13 others — covering 31,069 more features across Taipei, held as static files under `public/data/tier2/` and described by a manifest the tools read without loading a byte of feature data.

**Naming a category is what fetches it.** Pass `categories: ["restaurant"]` to `find_features`, `list_features_in_view`, `describe_surroundings` or `compare_areas` and it fetches every restaurant in the city once — 13,789 of them — and keeps them in memory for the rest of the session. There is no "list every category" call: loading all 18 at once would put 31,069 features into a browser tab for a question nobody asked. A query that omits `categories` is answered only from what is already loaded (the six bundled datasets plus whatever a category call already fetched this session) — and it says so: the answer's `unsearched_categories` names every category it did not search, each with its true city-wide count from the manifest, so "no cafes nearby" can never be confused with "no cafe file was ever fetched."

A few real counts from the manifest (`public/data/tier2/index.json`): `restaurant` 13,789, `convenience` 3,231, `bicycle_rental` 2,602 (YouBike stations), `cafe` 2,298, down to `museum` 119 and `hospital` 74. Full table, tag mapping and Overpass queries for all 18 are in [`public/data/README.md`](./public/data/README.md).

`select_features` still highlights every match a filter finds, its contract since the tool shipped — but once a point-of-interest category is involved, a filter matching more than 500 of them is refused rather than lighting up half the city: the answer gives the true count and asks for `near`+`radius_m`, `within` or `query` to narrow it. The six bundled categories are exempt from that cap.

A `get_share_link` link carries the *names* of every point-of-interest category the sender had loaded, not their features — the recipient's page fetches the same files itself — so opening the link rebuilds the sender's map, selection included, instead of resolving to features the recipient's session never heard of. A link that names a category is written as `v2`; a link with none still encodes to the exact `v1` bytes it always did, so no existing link breaks. The one exception is a map whose drawings would not fit in a URL at all: their coordinates then travel delta-encoded and the link is written as `v3` — smaller maps keep their old bytes, and every older link still decodes.

Fetching a category file can fail two honestly different ways: a **permanent** failure (this deployment ships no such file — a 404) drops the category and is not retried; a **transient** one (a slow connection, a rate-limited mirror — a 5xx, or a 408/425/429 that means "ask again") keeps the category on the books, including in any share link handed out meanwhile, so the next call simply tries again.

## Working together on the same map

The map is shared state, not a private channel for the agent:

- **Human draws, agent reads.** Click "Draw a polygon", add vertices, close it — the shape appears in `get_map_state().drawings` with `source: "user"` and is immediately queryable with `find_features({ within: "drawing:<n>" })`, the same call an agent uses on its own shapes.
- **Agent draws or annotates, human sees and edits.** A `draw_shape` or `annotate` call renders on the map at once and lists in the inspector's Shapes / Notes section with an "agent" or "user" provenance tag and a ✕ button to remove it — no confirmation dialog blocks either side.
- **A search box for humans, calling no tool.** Top-left, under the brand: type a place name and get results instantly from what the page already has loaded, plus a citywide name index for what it does not, and a list of categories the words might mean. Picking any of them moves the camera onto it (never zooming out) and writes a `source: "user"` selection; picking a citywide place first fetches its category, and picking a category outright loads and paints it exactly as the Places tray does, evictions included. None of this calls a tool, records an activity or wakes the agent chrome — it is the human half of the same question `find_features` answers for an agent.
- **A Places tray for browsing by kind.** The six bundled datasets are always painted; below them, a tap adds one of the 18 point-of-interest categories the tools fetch — "cafes" or "pharmacies" — up to three kinds painted at once; a fourth tap retires the oldest and says so out loud in the tray's foot line ("Cafés came off the map — 3 kinds of place at a time"), so nobody is left guessing what left.
- **`get_place_details`, echoed on the tap card.** The address, phone, website, opening hours and category-specific facts described under [Data and licensing](#data-and-licensing) are not agent-only: tapping the same pin opens a card that renders the same fields from the same table, so an agent saying "vegetarian, open till nine" and a person tapping the pin see the same two facts. The inspector's Selected list stays deliberately lean (name, English name when the data has one, and category) and does not repeat them — a ratified narrowing, not an oversight.
- **Inspector rows act, not just list.** Click a Selected, Shape or Note row and the camera flies to it — a point centres, an area or line is framed whole — except a Selected row whose id nothing has loaded, which is inert by design (nowhere to fly). Each Selected row carries its own ✕ to deselect just that one, and every row is keyboard reachable.
- **The human decides what chrome is on screen.** The page opens as a plain map and wakes into the agent view on the first live tool call — but the person can also open that view by hand (the corner spark's card offers a preview) and close it again at any time. A closed view stays closed while the agent keeps working; the spark carries a pulse and an exact count of the calls made since, and `get_map_state().bounds` always describes the rectangle actually on screen.
- **Two WebMCP APIs, one state.** Besides the imperative tools above, the inspector's pin-note field is a plain `<form toolname="add_note">` — the declarative half of WebMCP, filled in by a human or submitted by an agent with no JavaScript registration. `SubmitEvent.agentInvoked` tells the store which one happened, so the note is stored as `source: "agent"` or `source: "user"` honestly either way. Together the 14 registered tools and this one declarative form are the 15 the on-page WebMCP badge counts.

The address bar is part of that shared state, too: it always holds a link back to the map exactly as it stands, kept current whether the human or the agent made the last change, and opening that link — or one handed off from `get_share_link` — restores the same camera, selection, drawings and notes rather than a description of them. That is what lets a judge (or anyone else) reproduce what this README can only show as a screenshot.

## Seeing the agent work

Every tool call also plays out on the map itself, not just as a row in the activity feed: a read (`get_map_state`, `find_features`, `describe_surroundings`, …) washes translucent teal across whatever it looked at — a compass sweep, a glinting hit, a soft glow over the viewport — then fades to nothing; a write (`set_map_view`, `draw_shape`, `select_features`, `annotate`, …) materializes in the same teal as the change lands — a reticle drops onto the new camera centre, a shape draws itself on, a pin lands — and what's left behind is exactly the ordinary map state it always would have been. A shape or note a human adds by hand plays the identical two verbs in rose instead of teal, so who did what is legible without reading a word. Every effect is capped under two seconds and leaves zero residue on the canvas, and the matching row in the "Agent activity" feed glows on the same clock it animates on. Append `?fx=off` to the URL to turn the whole layer off, and it already honours `prefers-reduced-motion` (a short opacity crossfade plays instead of the full animation).

## Try it

### Chrome (149+)

1. Enable `chrome://flags/#enable-webmcp-testing` and restart Chrome.
2. Open **https://glassmap.clyeh.xyz** or run it locally (below).
3. Open the [Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp) extension (or any WebMCP-capable agent) and ask it one of these, verbatim:
   - *"Show every park within a 10-minute walk of Daan Station."* → `draw_shape` · `find_features` · `select_features`
   - *"Compare Daan District and Xinyi District for parks and supermarkets."* → `compare_areas`
   - *"Describe the area around Daan Station."* → `describe_surroundings`
4. Or skip the agent and call the tools directly from DevTools:

```js
const tools = await document.modelContext.getTools();
const byName = Object.fromEntries(tools.map(t => [t.name, t]));

// Move the camera by name — no coordinates needed.
await document.modelContext.executeTool(byName.set_map_view, { place: "Daan Park Station" });

// Everything within comfortable walking distance of the station.
const found = await document.modelContext.executeTool(byName.find_features, {
  near: "Daan Park Station",
  radius_m: 800,
  categories: ["park", "school"],
});
JSON.parse(found);
// → { total: <number in range>, returned: <number listed, ≤ limit>,
//     features: [ { id, name, name_en?, category: "park" | "school", distance_m, direction }, … ],
//     origin: { lng, lat },     // what these distances were measured from
//     radius_m: 800 }           // echoed back because near/radius_m bounded the search
// e.g. { total: 13, returned: 13, features: [
//     { id: "osm:way:1227733215", name: "大安森林公園", name_en: "Da-an Forest Park",
//       category: "park", distance_m: 355, direction: "S" }, … ],
//     origin: { lng: 121.53528, lat: 25.03356 }, radius_m: 800 }

// Draw a circle so the human can see the area, then ask what's inside it — the
// same "within" an agent would use to read a shape a human drew by hand.
const drawn = await document.modelContext.executeTool(byName.draw_shape, {
  type: "circle",
  center: "Daan Park Station",
  radius_m: 500,
  label: "5-minute walk",
});
const { drawing_id } = JSON.parse(drawn);
// → { drawing_id: "drawing:<n>", area_m2: <number>, state: { …, drawings: { count: 1, items: [...] } } }

const inside = await document.modelContext.executeTool(byName.find_features, {
  within: drawing_id,
  categories: ["park"],
});
JSON.parse(inside);
// → { total, returned, features: [ { id, name, category: "park", distance_m, direction }, … ] }
```

### ChatGPT desktop app

ChatGPT's built-in browser supports WebMCP tools on supported plans and models. Verified once, 2026-08-28, against this app's production build: ChatGPT desktop listed the 11 tools the page declared at the time and called `get_map_state` live — no Chrome flag needed. The roster has grown to fourteen tools since; that growth has not been re-verified against ChatGPT. Open the app URL in that browser and ask it to use the map.

### Any other browser

In development builds — or with `?shim=1` appended to the URL — GlassMap installs a small `document.modelContext` shim that implements the same `registerTool / getTools / executeTool / toolchange` surface, so the snippet above works even without the flag. The shim is never installed when a native implementation exists.

## Development

Requires Node 22+ (matches CI) and [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm check        # typecheck + lint + unit tests
pnpm test:e2e     # Playwright: drives the tools through document.modelContext
pnpm build
```

### Layout

```
src/
  app/                  Next.js App Router pages
  components/           React components (WebMcpProvider registers tools on mount)
  lib/
    webmcp/             WebMCP glue: ambient types, registration, dev shim
    map-tools/          Tool definitions + execute, decoupled from React/MapLibre
    store/              Zustand map state + the narrow MapToolStore adapter tools use
    geo/                Camera/projection math shared by the tools and the UI
    data/               Bundled dataset schema + GeoJSON loader
    awaken/             When the page wakes from a plain map into the agent view
  types/webmcp.d.ts     Types for document.modelContext / navigator.modelContext
e2e/                    Playwright specs
```

Tools talk to the map only through the `MapToolStore` interface, so they are unit-tested against an in-memory store and can be lifted out of this app.

Branching, worktrees, commit and PR conventions are in [CONTRIBUTING.md](./CONTRIBUTING.md). CI (`.github/workflows/ci.yml`) runs `pnpm check`, `pnpm build` and the Playwright suite on every PR.

### WebMCP registration

`src/lib/webmcp/register.ts` feature-detects both `document.modelContext` (current spec and Chrome) and `navigator.modelContext` (older shape some clients still expose) and registers on whichever exists. Registration is cancelled with an `AbortSignal`, per the current spec. Every tool's `execute` returns a JSON string, the lowest common denominator across clients.

## Architecture

Single Next.js app on Vercel. **No backend, no database, no API keys, no login.** One keyless external data service: `plan_route` asks the [FOSSGIS OSRM instance](https://routing.openstreetmap.de/) for walking routes at call time — throttled to their 1 request/second policy, credited on the page for the rest of the session once a route has been planned, and answering with an honest error (map unchanged) when unreachable. Everything else runs on bundled data entirely in the browser; the only other network the app touches is the keyless OpenFreeMap basemap tiles below, which stay display-only.

- [MapLibre GL JS](https://maplibre.org/) with [OpenFreeMap](https://openfreemap.org/) vector tiles (no key required)
- Bundled GeoJSON under `public/data/` (Taipei MRT stations, districts, parks, schools, supermarkets, sample listings)
- [Turf.js](https://turfjs.org/) for spatial queries in the browser
- [Zustand](https://zustand.docs.pmnd.rs/) for map state; share links encode the full state in the URL hash

## Data and licensing

Six GeoJSON files under `public/data/` are bundled and loaded on startup, prepared ahead of time by the scripts in `scripts/` — the running app never calls Overpass or any other external data API at runtime; the single exception is the `plan_route` routing request described under [Architecture](#architecture). A further 18 point-of-interest files under `public/data/tier2/` (31,069 features total) are prepared the same way but loaded lazily, one category at a time, on first use — by an agent naming the category, or by a human picking it from the search box or the Places tray (see [City-wide breadth](#city-wide-breadth) above). Full provenance, Overpass queries and export notes for all 24 categories are in [`public/data/README.md`](./public/data/README.md).

| Dataset | Category | Features |
|---|---|---:|
| MRT stations | `mrt_station` | 109 |
| Districts | `district` | 12 |
| Parks | `park` | 865 |
| Schools | `school` | 445 |
| Supermarkets | `supermarket` | 607 |
| Sample listings | `listing` | 25 (fabricated, not OSM) |

Tier-2 features can also carry up to eleven further OSM tags, added in this build's enrichment pass: address, phone, website and `wheelchair` (as OpenStreetMap tags it — never a verified accessibility claim) apply to any category; seven more are gated to one category each — hotel `stars`; parking `fee` and `capacity`; pharmacy `dispensing`; place-of-worship `religion` and `denomination`; hospital `emergency` (five categories, seven fields). Together with the `cuisine`/`brand`/`opening_hours` already used for search, that is fourteen OSM tags a tier-2 feature can carry in total — but only where a contributor entered them: coverage citywide across all 31,069 features is roughly 43% for `address`, 22% for `phone`, 14% for `wheelchair` and 9% for `website`, and a field's absence means the tag was never recorded, not that the place lacks the thing it names. These fields are answered by `get_place_details`, one place per call, and rendered on the human's tap card from the same table; the inspector's Selected list stays deliberately lean and does not repeat them (a ratified narrowing, not an oversight). The six bundled datasets above do not carry these fields at all.

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL](https://opendatacommons.org/licenses/odbl/). Tiles by [OpenFreeMap](https://openfreemap.org/).
- Listings shown in the demo are **sample data**, not real properties.
- Code: [MIT](./LICENSE).
