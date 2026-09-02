/**
 * The README's screenshot-agent clip (docs/media/screenshot-agent.gif).
 *
 * Replays, in Playwright's headless Chromium, what an agent with no tools can
 * do on the page: a search box, clicks, keys, the mouse wheel and screenshots.
 * Every `act` is one UI action and every `snap` one screenshot, so the counter
 * in the caption is the count the README quotes. No WebMCP surface is opened:
 * the URL carries no `?shim=1`.
 *
 *   pnpm build && pnpm start -p 3200          # in the repo root
 *   npm install                               # in scripts/media, once
 *   node s1-screenshot-agent.mjs http://localhost:3200/ out.gif
 */
import { launch, openReady, installOverlay, caption, shutter, clickAt, startScreencast, encodeGif, saveRaw, W, H } from "./lib.mjs";

const URL = process.argv[2] ?? "http://localhost:3200/";
const { browser, page } = await launch();
await openReady(page, URL);
await installOverlay(page);

let actions = 0, shots = 0;
const K = "shot";
const head = () => `Screenshot agent · no tools · ${actions} action${actions === 1 ? "" : "s"} · ${shots} screenshot${shots === 1 ? "" : "s"}`;
const say = (body, result) => caption(page, K, head(), body, result);
const snap = async (why) => { shots++; await say(why ?? "", ""); await shutter(page); };
const act = async (label, fn) => { actions++; await say(label); await fn(); };

const rec = startScreencast(page);
await rec.start();
await caption(page, K, "Screenshot agent · no tools", "“Show every park within a 10-minute walk of Daan Station.”", "Only what a generic browser agent has: screenshots, clicks, keys.");
await page.waitForTimeout(2600);

await snap("Screenshot → a citywide map. Where is Daan Station? Nothing here is readable as data.");
await page.waitForTimeout(1400);

await act("Click the search box", () => clickAt(page, 160, 80));
await act("Type “Daan Station”", async () => { await page.keyboard.type("Daan Station", { delay: 70 }); await page.waitForTimeout(900); });
await snap("Screenshot → “Nothing in Taipei matches that.” Try a shorter query.");
await page.waitForTimeout(600);
await act("Backspace ×8 → “Daan”", async () => { for (let i = 0; i < 8; i++) { await page.keyboard.press("Backspace"); await page.waitForTimeout(60); } await page.waitForTimeout(900); });
await snap("Screenshot → 8 rows, two of them “MRT”. Which is the station? Reading small text off pixels.");
await page.waitForTimeout(900);
const row = page.getByTestId("search-result").nth(4);
const box = await row.boundingBox();
await act("Click the 5th row — “大安 Daan · MRT”", () => clickAt(page, box.x + 60, box.y + box.height / 2));
await page.waitForTimeout(3800);

await snap("Screenshot → arrived, but 800 m around the station does not fit on screen at this zoom.");
await page.waitForTimeout(1600);
await act("Scroll out ×6 — how far is 800 m now? No scale bar to read. Guessing…", async () => {
  await page.mouse.move(W / 2, H / 2, { steps: 8 });
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(90); }
  await page.waitForTimeout(1200);
});
await snap("Screenshot → about this big? Pixel math without a scale bar is a guess.");
await page.waitForTimeout(1200);

// Hand-drawn "circle": an octagon around the station. 185 px at the zoom the wheel
// landed on (~z14.1) is ~755 m - a guess 5% short of the 800 m asked for.
const zoomNow = Number(await page.getByTestId("zoom").textContent());
const scale = 2 ** (zoomNow - 15); // px at this zoom per px at z15 (parks.mjs projected at z15)
const cx = W / 2, cy = H / 2, r = 185;
const drawBtn = await page.getByTestId("draw-toggle").boundingBox();
await act("Click “Draw”", () => clickAt(page, drawBtn.x + drawBtn.width / 2, drawBtn.y + drawBtn.height / 2));
await page.waitForTimeout(500);
for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
  const x = Math.round(cx + r * Math.cos(a)), y = Math.round(cy + r * Math.sin(a));
  await act(`Click vertex ${k + 1} of 8 — a polygon is the only shape a click can make`, () => clickAt(page, x, y, { ms: 320 }));
  await page.waitForTimeout(140);
}
await act("Press Enter to close the shape", async () => { await page.keyboard.press("Enter"); await page.waitForTimeout(700); });
await snap("Screenshot → an octagon, not a circle, and the radius is a guess. Now: which green shapes inside are parks?");
await page.waitForTimeout(1800);

// Read park names one tap card at a time (positions of two parks inside the octagon).
// Projected at z15 for a 960x600 viewport centred on the station (see parks.mjs).
const parks = [[cx - 58 * scale, cy - 158 * scale, "附中公園"], [cx + 83 * scale, cy + 139 * scale, "四維公園"]].map(([x, y, n]) => [Math.round(x), Math.round(y), n]);
console.log("zoom", zoomNow, "parks px", parks);
for (const [x, y] of parks) {
  await act("Click a green shape to see if a card opens", () => clickAt(page, x, y, { ms: 600 }));
  await page.waitForTimeout(900);
  await snap("Screenshot → read the card. One name learned.");
  await page.waitForTimeout(700);
  await act("Press Esc to close the card", async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(400); });
}
await say("Stopping here.", `Result: 2 park names after ${actions} actions and ${shots} screenshots — the walk radius is a guess, the “circle” is an octagon, and 5 of the 7 parks inside 800 m were never found.`);
await page.waitForTimeout(4200);

const data = await rec.stop();
await browser.close();
saveRaw(data, "s1.raw.json");
encodeGif(data, process.argv[3] ?? "s1-screenshot-agent.gif", { fps: 5, tol: 36, dump: 6 });
