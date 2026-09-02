import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";

function walk(d, out = []) { for (const n of readdirSync(d)) { const p = d + "/" + n; if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; }
let gz = 0; const per = [];
for (const f of walk("dist")) { const g = gzipSync(readFileSync(f)).length; gz += g; per.push([f, g]); }
console.log("GZIP_TOTAL_KB", (gz / 1024).toFixed(1));
for (const [f, g] of per) console.log("  ", f, (g / 1024).toFixed(1), "KB");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const t0 = Date.now();
await page.goto("http://127.0.0.1:4173/");
await page.waitForFunction(() => window.__snake && window.__snake.state().tick >= 1);
console.log("TTI_MS", Date.now() - t0);
await page.evaluate(() => window.__snake.setTier("low"));
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const work = await page.evaluate(async () => {
  const start = window.__snake.frameCount();
  while (window.__snake.frameCount() - start < 620) {
    await new Promise((r) => requestAnimationFrame(r));
    if (window.__snake.state().phase === "gameover") window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR", key: "r", bubbles: true }));
  }
  return window.__snake.frameWork();
});
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
const s = work.slice(-600).sort((a, b) => a - b);
console.log("LOW_4X_P50_MS", s[300].toFixed(2), "P95_MS", s[570].toFixed(2), "MAX_MS", s[599].toFixed(2));

await page.evaluate(() => window.__snake.setTier("ultra"));
await page.waitForFunction(() => { const f = window.__snake.fx(); return f.present && f.alive && f.frames > 5; }, null, { timeout: 15000 });
await page.waitForTimeout(500);
let maxDraw = 0;
for (let i = 0; i < 20; i++) { maxDraw = Math.max(maxDraw, await page.evaluate(() => window.__snake.fx().drawCount)); await page.waitForTimeout(25); }
console.log("ULTRA_DRAWCOUNT_MAX", maxDraw);
const ultraWork = await page.evaluate(async () => { const start = window.__snake.frameCount(); while (window.__snake.frameCount() - start < 300) await new Promise((r) => requestAnimationFrame(r)); return window.__snake.frameWork(); });
const u = ultraWork.slice(-300).sort((a, b) => a - b);
console.log("ULTRA_1X_P95_MS", u[285].toFixed(2));

await page.evaluate(() => window.__snake.forceDeath("wall"));
await page.waitForFunction(() => window.__snake.state().phase === "gameover");
const lumas = await page.evaluate(async () => { const out = []; const t0 = performance.now(); while (performance.now() - t0 < 1000) { await new Promise((r) => requestAnimationFrame(r)); const c = window.__snake.fbSample(128, 123); out.push(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]); } return out; });
let tr = 0; for (let i = 1; i < lumas.length; i++) if (Math.abs(lumas[i] - lumas[i - 1]) > 60) tr++;
console.log("DEATH_LUMA_SAMPLES", lumas.length, "TRANSITIONS_PER_S", tr);
console.log("CAPS", JSON.stringify(await page.evaluate(() => window.__snake.caps())), "AUTO_TIER", await page.evaluate(() => window.__snake.autoTier()));
await browser.close();
