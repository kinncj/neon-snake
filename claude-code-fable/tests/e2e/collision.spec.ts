import { test, expect } from "@playwright/test";
import { ready, useTier, luma } from "./snake-debug";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await ready(page);
});

test("a wall death fires sparks, a shockwave and a wall-local flash, then dissolves", async ({ page }) => {
  const ok = await useTier(page, "high");
  test.skip(!ok, "no WebGL engine in this browser");
  const before = await page.evaluate(() => window.__snake.fx().particles);
  await page.evaluate(() => window.__snake.forceDeath("wall"));
  await page.waitForFunction(() => window.__snake.state().phase === "gameover", null, { timeout: 3000 });
  await page.waitForTimeout(60);
  const s = await page.evaluate(() => window.__snake.fx());
  expect(s.particles).toBeGreaterThan(before + 50);
  expect(s.waves).toBeGreaterThan(0);
  expect(s.flashDir).toBe(0); // the right wall
  // The flash is local: the left edge of the field stays dark while it plays.
  const edges = await page.evaluate(() => {
    const f = window.__snake.fit();
    const y = f.dy + Math.floor(f.h / 2);
    return {
      left: window.__snake.glSample(f.dx + 3 * f.scale, y),
      right: window.__snake.glSample(f.dx + f.w - 3 * f.scale, y + 40 * f.scale)
    };
  });
  expect(luma(edges.left)).toBeLessThan(120);
  // Particles keep flying in the direction of travel (rightward), never sweeping the centre.
  const dirs = await page.evaluate(() => window.__snake.fx().particleDrift);
  expect(dirs.vx).toBeGreaterThan(0);
  await page.waitForTimeout(700);
  const later = await page.evaluate(() => window.__snake.fx());
  expect(later.dissolve).toBeGreaterThan(0.5);
});

test("a self-bite chomps: blood particles with gravity, no wall flash", async ({ page }) => {
  const ok = await useTier(page, "high");
  test.skip(!ok, "no WebGL engine in this browser");
  await page.evaluate(() => window.__snake.forceDeath("self"));
  await page.waitForFunction(() => window.__snake.state().phase === "gameover", null, { timeout: 3000 });
  await page.waitForTimeout(60);
  const s = await page.evaluate(() => window.__snake.fx());
  expect(s.particles).toBeGreaterThan(50);
  expect(s.flashDir).toBe(-1);
  const drift = await page.evaluate(() => window.__snake.fx().particleDrift);
  expect(drift.gravity).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__snake.audio().lastSfx)).toMatch(/splat|gameover|^$/);
});

test("both deaths end on the gameover panel and a restart clears the FX", async ({ page }) => {
  const ok = await useTier(page, "high");
  test.skip(!ok, "no WebGL engine in this browser");
  await page.evaluate(() => window.__snake.forceDeath("wall"));
  await page.waitForFunction(() => window.__snake.state().phase === "gameover", null, { timeout: 3000 });
  await expect(page.locator("#overlay")).toBeVisible();
  await page.keyboard.press("KeyR");
  await page.waitForFunction(() => window.__snake.state().phase === "playing");
  await page.waitForTimeout(100);
  const s = await page.evaluate(() => window.__snake.fx());
  expect(s.dissolve).toBe(0);
  expect(s.particles).toBe(0);
});
