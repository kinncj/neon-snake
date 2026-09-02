import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ready, useTier, sample, snakeState } from "./snake-debug";

const LOG = readFileSync("tests/fixtures/run-a.log", "utf8");

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await ready(page);
});

test("the replayed log is hash-identical at every tier (tier-independent simulation)", async ({ page }) => {
  const hashes: Record<string, string> = {};
  for (const tier of ["low", "high", "ultra", "reduced"]) {
    await useTier(page, tier);
    hashes[tier] = await page.evaluate(([log, ticks]) => window.__snake.replay(log as string, ticks as number), [LOG, 5000]);
  }
  expect(hashes["low"]).toMatch(/^[0-9a-f]{8}$/);
  expect(hashes["high"]).toBe(hashes["low"]);
  expect(hashes["ultra"]).toBe(hashes["low"]);
  expect(hashes["reduced"]).toBe(hashes["low"]);
});

test("at ultra, eating fires a shockwave + burst and bloom rises then decays within 400 ms", async ({ page }) => {
  const ok = await useTier(page, "ultra");
  test.skip(!ok, "no WebGL engine in this browser");
  await page.waitForTimeout(200);
  const base = await page.evaluate(() => window.__snake.fx().bloom);
  const samples = await page.evaluate(async () => {
    const out: Array<[number, number]> = [];
    const score0 = window.__snake.state().score;
    window.__snake.foodAhead();
    const t0 = performance.now();
    let eatAt = -1;
    while (performance.now() - t0 < 2000) {
      await new Promise((r) => setTimeout(r, 16));
      const t = performance.now() - t0;
      if (eatAt < 0 && window.__snake.state().score !== score0) eatAt = t;
      if (eatAt >= 0) out.push([t - eatAt, window.__snake.fx().bloom]);
      if (eatAt >= 0 && t - eatAt > 650) break;
    }
    return { out, eatAt, score: window.__snake.state().score, score0 };
  });
  expect(samples.eatAt).toBeGreaterThanOrEqual(0);
  expect(samples.score).toBeGreaterThan(samples.score0);
  const peak = Math.max(...samples.out.map((s) => s[1]));
  expect(peak).toBeGreaterThan(base + 1); // bloom rose
  const settled = samples.out.filter((s) => s[0] > 450);
  expect(settled.length).toBeGreaterThan(0);
  for (const s of settled) expect(s[1]).toBeLessThanOrEqual(base + 0.5); // and decayed within 400 ms
});

test("the death sequence never exceeds 3 full-frame luminance transitions per second", async ({ page }) => {
  const ok = await useTier(page, "ultra");
  test.skip(!ok, "no WebGL engine in this browser");
  await page.evaluate(() => window.__snake.forceDeath("wall"));
  await page.waitForFunction(() => window.__snake.state().phase === "gameover", null, { timeout: 3000 });
  // Sample the 2D framebuffer (deterministic, always redrawn) just under the
  // field centre once per animation frame for one second and count swings.
  const lumas = await page.evaluate(async () => {
    const out: number[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 1000) {
      await new Promise((r) => requestAnimationFrame(r));
      const c = window.__snake.fbSample(128, 123);
      out.push(0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!);
    }
    return out;
  });
  let transitions = 0;
  for (let i = 1; i < lumas.length; i++) if (Math.abs(lumas[i]! - lumas[i - 1]!) > 60) transitions++;
  expect(lumas.length).toBeGreaterThan(10);
  expect(transitions).toBeLessThanOrEqual(3);
  expect((await snakeState(page)).phase).toBe("gameover");
});

test("at low the engine ticker sleeps and the composite still draws the field", async ({ page }) => {
  await useTier(page, "high");
  await page.waitForTimeout(200);
  await useTier(page, "low");
  const f1 = await page.evaluate(() => window.__snake.fx());
  await page.waitForTimeout(300);
  const f2 = await page.evaluate(() => window.__snake.fx());
  if (f1.present) expect(f2.frames).toBe(f1.frames);
  const fitv = await page.evaluate(() => window.__snake.fit());
  const c = await sample(page, fitv.dx + 2, fitv.dy + 2);
  expect(c[0]! + c[1]! + c[2]!).toBeGreaterThan(0);
  const vis = await page.evaluate(() => getComputedStyle(document.getElementById("fx")!).visibility);
  expect(vis).toBe("hidden");
});
