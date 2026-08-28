# GlassMap

**An agent-native web map.** GlassMap uses [WebMCP](https://webmachinelearning.github.io/webmcp/) to turn the map canvas from a black box into a semantic surface: an AI agent can read the current view, find features, move the camera, draw shapes and annotate the map **without taking a single screenshot** — and the human watches it happen on the same map.

> Built for [The WebMCP Challenge](https://webmcp.devpost.com/) (Aug 25 – Sep 3, 2026).
> **Status: early scaffold.** Two tools work end-to-end against an in-memory map state; the MapLibre map and the remaining tools are in progress. See [Roadmap](#roadmap).

## Why "Glass"

A web map is a WebGL canvas. To a browser agent every station, park and pin is just pixels:

- To *see*, it must screenshot and let a multimodal model guess what the markers are.
- To *act*, it must click at coordinates that stop being valid the moment the zoom changes.
- To *draw a polygon*, *measure a distance* or *select every park in view*, it has essentially no way at all.

Maps are the largest "DOM without semantics" surface on the web. WebMCP fills exactly that gap: the page exposes map state, features and actions as structured tools, so the agent never has to look at pixels. The black box becomes **glass** — the agent sees straight through the canvas to the data underneath.

The same opacity that blocks agents also blocks screen readers, so the read-only tools double as a semantic layer for people who cannot see the map. We call this *agent-mediated map access*; it is not a WCAG or accessibility-compliance claim.

## What an agent can do

| You say | Without WebMCP | With GlassMap |
|---|---|---|
| "Move the map to Daan Park Station" | screenshot → find search box → type → screenshot → maybe click the wrong result | `set_map_view({ place: "Daan Park Station" })` |
| "Which parks are in view?" | screenshot → guess that green blobs are parks → can't read names | `list_features_in_view({ categories: ["park"] })` |
| "Circle an 800 m walk from the station" | nearly impossible: compute a pixel radius at the right zoom, then drag | `draw_shape({ type: "circle", center: …, radius_m: 800 })` |
| "What's inside the area I just drew?" | impossible — the agent cannot see vector geometry | `find_features({ within: "drawing:1" })` |
| "I can't see the map. Where's the nearest park?" | impossible | `describe_surroundings()` → "Daan Forest Park, 320 m northeast" |

## Tools

Three layers. Every write tool returns the new map state so the agent never needs a follow-up read.

```
Perceive (read-only, replaces screenshots)   Navigate (camera only)   Act (page state, no server)
├─ get_map_state              ✅             ├─ set_map_view  ✅      ├─ draw_shape
├─ list_features_in_view                     └─ set_layers            ├─ select_features
├─ find_features                                                      ├─ annotate
├─ describe_surroundings                                              └─ get_share_link
├─ measure
└─ compare_areas
```

✅ = implemented and covered by tests. Everything else is planned — see [Roadmap](#roadmap).

Design rules the tool layer follows:

- Read-only tools carry `readOnlyHint: true` so clients can skip confirmation prompts.
- Output that contains OpenStreetMap or user-entered text carries `untrustedContentHint: true`.
- Responses are small on purpose: `limit` defaults to 20, coordinates are rounded to 5 decimals, geometry is returned by id rather than inline.
- Bad input returns a structured `{ error }` instead of throwing, so the agent can recover.
- No `alert` / `confirm` / `prompt` anywhere — modal dialogs freeze agents.

## Try it

### Chrome (149+)

1. Enable `chrome://flags/#enable-webmcp-testing` and restart Chrome.
2. Open the deployed app *(URL coming soon)* or run it locally (below).
3. Use the [Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp) extension, or open DevTools and call the API directly:

```js
const tools = await document.modelContext.getTools();
const byName = Object.fromEntries(tools.map(t => [t.name, t]));
await document.modelContext.executeTool(byName.set_map_view, { center: { lng: 121.5436, lat: 25.0264 }, zoom: 15 });
await document.modelContext.executeTool(byName.get_map_state, {});
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

| Day | Deliverable |
|---|---|
| D1 | MapLibre + OpenFreeMap on Vercel; `get_map_state` and `set_map_view` on a real map; verify a WebMCP client can call them |
| D2 | GeoJSON data; `list_features_in_view`, `find_features`, `select_features` + sidebar |
| D3 | `draw_shape` (agent- and hand-drawn), `annotate`, `describe_surroundings` |
| D4 | `compare_areas`, `get_share_link`, `measure`, `set_layers`; screenshot-vs-WebMCP comparison |
| D5 | Demo video, submission text |

## Data and licensing

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL](https://opendatacommons.org/licenses/odbl/). Tiles by [OpenFreeMap](https://openfreemap.org/).
- Listings shown in the demo are **sample data**, not real properties.
- Code: [MIT](./LICENSE).
