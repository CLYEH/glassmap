# GlassMap

**An agent-native web map.** GlassMap uses [WebMCP](https://webmachinelearning.github.io/webmcp/) to turn the map canvas from a black box into a semantic surface: an AI agent can read the current view, find features, move the camera, draw shapes and annotate the map **without taking a single screenshot** — and the human watches it happen on the same map.

> Live: **https://glassmap.clyeh.xyz** · Built for [The WebMCP Challenge](https://webmcp.devpost.com/) (Aug 25 – Sep 3, 2026).
> **Status:** all eight tools are implemented and unit-tested — `get_map_state`, `set_map_view`, `list_features_in_view`, `find_features`, `select_features`, `draw_shape`, `annotate`, `describe_surroundings` — backed by 2,063 bundled Taipei features (real OpenStreetMap data, plus 25 fabricated sample listings). The interactive map, hand-drawing, annotations and the sidebar are live. Remaining: the screenshot-vs-WebMCP comparison measurement, `get_share_link`, the nice-to-have `measure`/`compare_areas`/`set_layers` tools, and the demo video. See [Roadmap](#roadmap).

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
| "I can't see the map. Where's the nearest park?" | impossible | `describe_surroundings()` → nearest features grouped by direction, each with a name, distance in metres and id |

## Tools

Three layers, all eight tools implemented. Every write tool returns the new map state so the agent never needs a follow-up read.

```
Perceive (read-only, replaces screenshots)   Navigate (camera only)   Act (page state, no server)
├─ get_map_state ✅                          ├─ set_map_view ✅       ├─ draw_shape ✅
├─ list_features_in_view ✅                  └─ set_layers            ├─ select_features ✅
├─ find_features ✅                                                   ├─ annotate ✅
├─ describe_surroundings ✅                                           └─ get_share_link
├─ measure
└─ compare_areas
```

✅ = implemented and covered by unit tests. Everything else is planned — see [Roadmap](#roadmap).

| Tool | What it does | Key inputs |
|---|---|---|
| `get_map_state` | Reads the camera, visible bounds, feature count, selection, drawings and annotations in one call — the read that used to require a screenshot. | *(none)* |
| `set_map_view` | Moves the camera: by exact `center`/`zoom`/`bearing`/`pitch`, by `feature_id`, or by `place` name resolved against the loaded data. An ambiguous `place` does not move the map — it returns candidates with distances instead. | `place`, `feature_id`, `center`, `zoom`, `bearing`, `pitch` |
| `list_features_in_view` | Lists loaded features whose bounds overlap the current view, nearest-first, each with distance in metres and an 8-point compass direction from the view centre. | `categories`, `limit` |
| `find_features` | Searches every loaded feature, not just what's visible, by name substring, category, distance from a place/feature/coordinate, and whether it's inside a shape on the map — including one a human drew by hand. | `query`, `categories`, `near`, `radius_m`, `within`, `limit` |
| `select_features` | Highlights features on the map and in the sidebar, by explicit ids or the same `query`/`near`/`radius_m`/`categories`/`within` filter `find_features` accepts — but selects every match, not just the first `limit`. | `ids` or filter, `within`, `replace` |
| `draw_shape` | Draws a circle, polygon or line on the map so the human can see the area being discussed; returns its area (circle/polygon) or length (line) and a `drawing:<n>` id. | `type`, `center`+`radius_m` (circle) or `coordinates` (polygon/line), `label` |
| `annotate` | Pins a short note to a place on the map, so the human sees what was found where it was found. | `at`, `note`, `icon` |
| `describe_surroundings` | Describes what's around a point the way a person would say it out loud: the district, then nearby features grouped by compass direction, nearest first, each with a distance and an id. | `from`, `radius_m` |

`within: "drawing:<n>"` on `find_features` and `select_features` is the read half of the collaborative loop: any circle or polygon on the map — agent-drawn or hand-drawn by a human — becomes something an agent can query by id, not just something rendered on screen. (A line has no inside, so `within` does not apply to it.)

Design rules the tool layer follows:

- Every write tool (`set_map_view`, `select_features`, `draw_shape`, `annotate`) returns the full new map state, so the agent never needs a follow-up read.
- Read-only tools carry `readOnlyHint: true` so clients can skip confirmation prompts.
- Output that contains OpenStreetMap or user-entered text carries `untrustedContentHint: true`.
- Responses are small on purpose: `limit` defaults to 20, coordinates are rounded to 5 decimals, geometry is returned by id rather than inline.
- Bad input returns a structured `{ error }` instead of throwing, so the agent can recover.
- No `alert` / `confirm` / `prompt` anywhere — modal dialogs freeze agents.

## Working together on the same map

The map is shared state, not a private channel for the agent:

- **Human draws, agent reads.** Click "Draw a polygon", add vertices, close it — the shape appears in `get_map_state().drawings` with `source: "user"` and is immediately queryable with `find_features({ within: "drawing:<n>" })`, the same call an agent uses on its own shapes.
- **Agent draws or annotates, human sees and edits.** A `draw_shape` or `annotate` call renders on the map at once and lists in the sidebar with a "drawn by agent" / "pinned by agent" label and a ✕ button to remove it — no confirmation dialog blocks either side.
- **Two WebMCP APIs, one state.** Besides the imperative tools above, the sidebar's note field is a plain `<form toolname="add_note">` — the declarative half of WebMCP, filled in by a human or submitted by an agent with no JavaScript registration. `SubmitEvent.agentInvoked` tells the store which one happened, so the note is stored as `source: "agent"` or `source: "user"` honestly either way.

## Try it

### Chrome (149+)

1. Enable `chrome://flags/#enable-webmcp-testing` and restart Chrome.
2. Open **https://glassmap.clyeh.xyz** or run it locally (below).
3. Use the [Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp) extension, or open DevTools and call the API directly:

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
// → { total: <number in range>, returned: <number listed, ≤ limit>, features: [
//     { id, name, name_en?, category: "park" | "school", distance_m, direction }, … ] }
// e.g. { id: "osm:way:1227733215", name: "大安森林公園", name_en: "Da-an Forest Park",
//        category: "park", distance_m: <metres>, direction: <compass point> }

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

ChatGPT's built-in browser supports WebMCP tools on supported plans and models. Open the app URL in that browser and ask it to use the map. *(Verification on our side is still pending.)*

### Any other browser

In development builds — or with `?shim=1` appended to the URL — GlassMap installs a small `document.modelContext` shim that implements the same `registerTool / getTools / executeTool / toolchange` surface, so the snippet above works even without the flag. The shim is never installed when a native implementation exists.

## Development

Requires Node 20+ and [pnpm](https://pnpm.io/).

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
  types/webmcp.d.ts     Types for document.modelContext / navigator.modelContext
e2e/                    Playwright specs
```

Tools talk to the map only through the `MapToolStore` interface, so they are unit-tested against an in-memory store and can be lifted out of this app.

Branching, worktrees, commit and PR conventions are in [CONTRIBUTING.md](./CONTRIBUTING.md). CI (`.github/workflows/ci.yml`) runs `pnpm check`, `pnpm build` and the Playwright suite on every PR.

### WebMCP registration

`src/lib/webmcp/register.ts` feature-detects both `document.modelContext` (current spec and Chrome) and `navigator.modelContext` (older shape some clients still expose) and registers on whichever exists. Registration is cancelled with an `AbortSignal`, per the current spec. Every tool's `execute` returns a JSON string, the lowest common denominator across clients.

## Architecture

Single Next.js app on Vercel. **No backend, no database, no API keys, no login.**

- [MapLibre GL JS](https://maplibre.org/) with [OpenFreeMap](https://openfreemap.org/) vector tiles (no key required)
- Bundled GeoJSON under `public/data/` (Taipei MRT stations, districts, parks, schools, supermarkets, sample listings)
- [Turf.js](https://turfjs.org/) for spatial queries in the browser
- [Zustand](https://zustand.docs.pmnd.rs/) for map state; share links encode the full state in the URL hash

## Roadmap

| Day | Deliverable | Status |
|---|---|---|
| D1 | MapLibre + OpenFreeMap on Vercel; `get_map_state` and `set_map_view` on a real map; verify a WebMCP client can call them | done |
| D2 | GeoJSON data; `list_features_in_view`, `find_features`, `select_features` + sidebar | done |
| D3 | `draw_shape` (agent- and hand-drawn), `annotate`, `describe_surroundings` | done |
| D4 | `compare_areas`, `get_share_link`, `measure`, `set_layers`; screenshot-vs-WebMCP comparison | todo |
| D5 | Demo video, submission text | todo |

## Data and licensing

Six GeoJSON files bundled under `public/data/`, prepared ahead of time by the scripts in `scripts/` — the running app never calls Overpass or any other external data API. Full provenance, Overpass queries and export notes are in [`public/data/README.md`](./public/data/README.md).

| Dataset | Category | Features |
|---|---|---:|
| MRT stations | `mrt_station` | 109 |
| Districts | `district` | 12 |
| Parks | `park` | 865 |
| Schools | `school` | 445 |
| Supermarkets | `supermarket` | 607 |
| Sample listings | `listing` | 25 (fabricated, not OSM) |

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL](https://opendatacommons.org/licenses/odbl/). Tiles by [OpenFreeMap](https://openfreemap.org/).
- Listings shown in the demo are **sample data**, not real properties.
- Code: [MIT](./LICENSE).
