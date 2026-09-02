/**
 * The README's WebMCP-agent clip (docs/media/webmcp-agent.gif).
 *
 * Replays the same ask through the page's tools: every call goes through
 * `document.modelContext.getTools()` → `executeTool()`, and the caption counts
 * calls, bytes returned and tool time as measured in the page. Headless
 * Chromium has no WebMCP of its own, so the URL carries `?shim=1`; the tool
 * code and its output are the ones a native surface runs.
 *
 *   pnpm build && pnpm start -p 3205          # in the repo root
 *   npm install                               # in scripts/media, once
 *   node s2-webmcp.mjs "http://localhost:3205/?shim=1" out.gif
 */
import { launch, openReady, installOverlay, caption, startScreencast, encodeGif, saveRaw } from "./lib.mjs";

const URL = process.argv[2] ?? "http://localhost:3205/?shim=1";
const { browser, page } = await launch();
await openReady(page, URL);
await installOverlay(page);

// Every call goes through the WebMCP surface itself: document.modelContext.getTools() → executeTool().
const mcp = (name, input) => page.evaluate(async ([n, a]) => {
  const tools = await document.modelContext.getTools();
  const t = tools.find((x) => x.name === n);
  const t0 = performance.now();
  const out = await document.modelContext.executeTool(t, a);
  return { out: JSON.parse(out), ms: Math.round(performance.now() - t0), bytes: new TextEncoder().encode(out).length };
}, [name, input]);

let calls = 0, bytes = 0, ms = 0;
const K = "mcp";
const head = () => `WebMCP agent · document.modelContext · ${calls} call${calls === 1 ? "" : "s"} · 0 screenshots`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt = (name, input) => `${name}(${JSON.stringify(input, null, 1).replace(/\n\s*/g, " ").replace(/^\{ /, "{ ").replace(/ \}$/, " }")})`;
const call = async (name, input, summarize, { think = 1100, hold = 2600, show } = {}) => {
  const code = esc(show ?? fmt(name, input));
  await caption(page, K, head(), code, "");
  await page.waitForTimeout(think);
  const r = await mcp(name, input);
  calls++; bytes += r.bytes; ms += r.ms;
  await caption(page, K, head(), code, `→ ${esc(summarize(r.out))} · ${r.bytes} B · ${r.ms} ms`);
  await page.waitForTimeout(hold);
  return r.out;
};

const rec = startScreencast(page);
await rec.start();
await caption(page, K, "WebMCP agent · document.modelContext", "“Show every park within a 10-minute walk of Daan Station.”", "Same page, same question. The agent reads and writes the map through its tools.");
await page.waitForTimeout(2600);

await call("set_map_view", { place: "Daan Station" },
  (o) => `found · centre ${o.center.lng}, ${o.center.lat} · zoom ${o.zoom}`, { hold: 3400 });

await call("draw_shape", { type: "circle", center: "Daan Station", radius_m: 800, label: "10-minute walk" },
  (o) => `${o.drawing_id} · a true circle, ${(o.area_m2 / 1e6).toFixed(2)} km²`);

await call("set_map_view", { fit: "drawing:1" },
  (o) => `framed the circle · zoom ${o.zoom.toFixed(1)}`, { hold: 3000 });

const f = await call("find_features", { near: "Daan Station", radius_m: 800, categories: ["park"] },
  (o) => `${o.total} parks, nearest first: ${o.features.slice(0, 3).map((x) => `${x.name} ${x.distance_m} m ${x.direction}`).join(", ")}, …`, { hold: 3600 });

const ids = f.features.map((x) => x.id);
await call("select_features", { ids },
  (o) => `${o.selection?.count ?? o.state?.selection?.count ?? "?"} selected — highlighted for the human on the map and in the panel`,
  { hold: 3200, show: `select_features({ "ids": [ "${ids[0]}", … ${ids.length} ids from find_features ] })` });

await caption(page, K, head(), "Done.", `Result: all ${f.total} parks inside an exact 800 m circle, each with an id, a distance and a direction — two of them OpenStreetMap never named — ${calls} calls, ${(bytes / 1024).toFixed(1)} KB returned, ${ms} ms of tool time, 0 screenshots.`);
await page.waitForTimeout(4200);

const data = await rec.stop();
await browser.close();
saveRaw(data, "s2.raw.json");
encodeGif(data, process.argv[3] ?? "s2-webmcp.gif", { fps: 5, tol: 36, dump: 6 });
