/**
 * Shared recording helpers for the two README clips: a headless Chromium with
 * software WebGL, a caption box and visible cursor injected into the page, CDP
 * screencast capture, and a GIF encoder (gifenc + jpeg-js). Playwright comes
 * from the repo's own install; run `npm install` in this folder for the rest.
 */
import { chromium } from "../../node_modules/@playwright/test/index.mjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import jpeg from "jpeg-js";
import fs from "node:fs";

export const W = Number(process.env.REC_W ?? 960), H = Number(process.env.REC_H ?? 600);

export async function launch() {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--force-device-scale-factor=1"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  return { browser, page };
}

export async function openReady(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__glassmap);
  await page.waitForFunction(() => document.querySelector('[data-testid="feature-count"]')?.textContent === "2063");
  await page.waitForFunction(() => document.querySelector('[data-testid="map-status"]')?.textContent === "ready", null, { timeout: 30000 });
  await page.waitForTimeout(2500);
}

/** Caption box + fake cursor + shutter flash, injected once. Recording-only overlay. */
export async function installOverlay(page) {
  await page.evaluate(() => {
    const css = document.createElement("style");
    css.textContent = `
      #rec-cap{position:fixed;left:14px;bottom:14px;z-index:99999;max-width:372px;padding:10px 14px;border-radius:12px;
        background:rgba(18,20,24,.92);color:#f3f4f6;font:500 15px/1.35 -apple-system,Inter,system-ui,sans-serif;
        box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none;border:1px solid rgba(255,255,255,.08)}
      #rec-cap .k{display:block;font:700 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;opacity:.85}
      #rec-cap .k.shot{color:#fb7185}#rec-cap .k.mcp{color:#2dd4bf}
      #rec-cap code{font:500 14px/1.4 ui-monospace,Menlo,monospace;color:#a5f3fc;white-space:pre-wrap;word-break:break-word}
      #rec-cap .r{display:block;margin-top:5px;color:#cbd5e1;font-size:14px}
      #rec-cur{position:fixed;z-index:100000;width:22px;height:22px;pointer-events:none;transform:translate(-3px,-2px);
        filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));display:none}
      #rec-flash{position:fixed;inset:0;z-index:99998;opacity:0;pointer-events:none;transition:opacity .1s;box-shadow:inset 0 0 0 6px #fb7185}
      .rec-ripple{position:fixed;z-index:99999;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #fb7185;
        pointer-events:none;animation:rec-rip .5s ease-out forwards}
      @keyframes rec-rip{from{transform:scale(1);opacity:.9}to{transform:scale(4);opacity:0}}
    `;
    document.head.appendChild(css);
    const cap = document.createElement("div"); cap.id = "rec-cap"; cap.style.display = "none"; document.body.appendChild(cap);
    const flash = document.createElement("div"); flash.id = "rec-flash"; document.body.appendChild(flash);
    const cur = document.createElement("div"); cur.id = "rec-cur";
    cur.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8-6.5 1.5L9 19z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
    window.addEventListener("mousemove", (e) => { cur.style.display = "block"; cur.style.left = e.clientX + "px"; cur.style.top = e.clientY + "px"; }, true);
    window.__recRipple = (x, y) => { const d = document.createElement("div"); d.className = "rec-ripple"; d.style.left = x + "px"; d.style.top = y + "px"; document.body.appendChild(d); setTimeout(() => d.remove(), 600); };
  });
}

export async function caption(page, kind, head, body, result) {
  await page.evaluate(([kind, head, body, result]) => {
    const cap = document.getElementById("rec-cap");
    cap.style.display = "block";
    cap.innerHTML = `<span class="k ${kind}">${head}</span>` + (body ? `<code>${body}</code>` : "") + (result ? `<span class="r">${result}</span>` : "");
  }, [kind, head, body ?? "", result ?? ""]);
}

export async function shutter(page) {
  // A thin inset frame, not a full-screen flash: a full-frame change costs ~250 KB in the GIF.
  await page.evaluate(() => { const f = document.getElementById("rec-flash"); f.style.opacity = "1"; setTimeout(() => (f.style.opacity = "0"), 220); });
  await page.waitForTimeout(340);
}

/** Move the (visible) cursor there over `ms`, click with a ripple. */
export async function clickAt(page, x, y, { ms = 450, ripple = true } = {}) {
  await page.mouse.move(x, y, { steps: Math.max(6, Math.round(ms / 30)) });
  await page.waitForTimeout(120);
  if (ripple) await page.evaluate(([x, y]) => window.__recRipple(x, y), [x, y]);
  await page.mouse.click(x, y);
}

export function startScreencast(page) {
  const frames = [];
  let cdp;
  const t0 = Date.now();
  const start = async () => {
    cdp = await page.context().newCDPSession(page);
    cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
      frames.push({ t: Date.now() - t0, jpg: Buffer.from(data, "base64") });
      try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch {}
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  };
  const stop = async () => { try { await cdp.send("Page.stopScreencast"); } catch {} return { frames, total: Date.now() - t0 }; };
  return { start, stop };
}

/** Resample to fixed fps, encode with a global palette + inter-frame transparency. */
export function encodeGif({ frames, total }, outPath, { fps = 5, holdLast = 1500, colors = 255, dump = 0, tol = 30 } = {}) {
  const step = 1000 / fps;
  const picked = [];
  let fi = 0;
  for (let t = 0; t <= total; t += step) {
    while (fi + 1 < frames.length && frames[fi + 1].t <= t) fi++;
    if (frames[fi] && frames[fi].t <= t) picked.push(frames[fi]);
  }
  // collapse identical consecutive frames into longer delays
  const runs = [];
  for (const f of picked) {
    const last = runs[runs.length - 1];
    if (last && last.jpg.equals(f.jpg)) last.delay += step; else runs.push({ jpg: f.jpg, delay: step });
  }
  runs[runs.length - 1].delay += holdLast;
  console.log(`frames captured ${frames.length}, ticks ${picked.length}, unique ${runs.length}, ${Math.round(total / 1000)}s`);
  if (dump) { fs.mkdirSync(outPath + ".frames", { recursive: true }); runs.forEach((r, i) => { if (i % dump === 0) fs.writeFileSync(`${outPath}.frames/${String(i).padStart(3, "0")}.jpg`, r.jpg); }); }
  const decoded = runs.map((r) => jpeg.decode(r.jpg, { useTArray: true, formatAsRGBA: true }));
  const w = decoded[0].width, h = decoded[0].height;
  // global palette from a sample of frames
  const sampleEvery = Math.max(1, Math.floor(decoded.length / 12));
  const samples = decoded.filter((_, i) => i % sampleEvery === 0);
  const px = 6;
  const chunks = samples.map((d) => { const out = new Uint8Array(Math.ceil(d.data.length / (4 * px)) * 4); let o = 0; for (let i = 0; i < d.data.length; i += 4 * px) { out[o++] = d.data[i]; out[o++] = d.data[i + 1]; out[o++] = d.data[i + 2]; out[o++] = 255; } return out; });
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let off = 0; for (const c of chunks) { all.set(c, off); off += c.length; }
  const palette = quantize(all, colors, { format: "rgb444" });
  const TRANSPARENT = 255;
  while (palette.length < 256) palette.push([0, 0, 0]);
  const gif = GIFEncoder();
  // Noise-tolerant differencing against what the viewer currently sees (the composited
  // frame), so JPEG jitter does not re-emit pixels; `tol` is a summed |dR|+|dG|+|dB|.
  let shown = null;
  decoded.forEach((d, i) => {
    const idx = applyPalette(d.data, palette, "rgb444");
    let out = idx;
    if (!shown) {
      // `shown` holds the SOURCE rgb of the last emitted pixel, so the comparison is
      // jitter-vs-jitter and never confuses quantisation error with real change.
      shown = new Uint8Array(idx.length * 3);
      for (let p = 0; p < idx.length; p++) { const q = p * 4; shown[p * 3] = d.data[q]; shown[p * 3 + 1] = d.data[q + 1]; shown[p * 3 + 2] = d.data[q + 2]; }
    } else {
      out = new Uint8Array(idx.length);
      for (let p = 0; p < idx.length; p++) {
        const q = p * 4, s3 = p * 3;
        const dist = Math.abs(d.data[q] - shown[s3]) + Math.abs(d.data[q + 1] - shown[s3 + 1]) + Math.abs(d.data[q + 2] - shown[s3 + 2]);
        if (dist <= tol) { out[p] = TRANSPARENT; continue; }
        out[p] = idx[p];
        shown[s3] = d.data[q]; shown[s3 + 1] = d.data[q + 1]; shown[s3 + 2] = d.data[q + 2];
      }
    }
    gif.writeFrame(out, w, h, { palette: i === 0 ? palette : undefined, first: i === 0, repeat: 0, delay: Math.round(runs[i].delay), transparent: i > 0, transparentIndex: TRANSPARENT, dispose: 1 });
  });
  gif.finish();
  const bytes = gif.bytes();
  fs.writeFileSync(outPath, bytes);
  console.log(`${outPath}: ${(bytes.length / 1024 / 1024).toFixed(2)} MB, ${w}x${h}`);
}

/** Persist captured frames so encodings can be retried without re-recording. */
export function saveRaw({ frames, total }, path) {
  fs.writeFileSync(path, JSON.stringify({ total, frames: frames.map((f) => ({ t: f.t, jpg: f.jpg.toString("base64") })) }));
}
export function loadRaw(path) {
  const { total, frames } = JSON.parse(fs.readFileSync(path, "utf8"));
  return { total, frames: frames.map((f) => ({ t: f.t, jpg: Buffer.from(f.jpg, "base64") })) };
}
