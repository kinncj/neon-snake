import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { ready, useTier } from "./snake-debug";

/**
 * Playtest screenshots for docs/screenshots. Opt-in (SHOTS=1) because they
 * write files and take a few seconds; the images are committed with the
 * docs and regenerated when the look changes:
 *   SHOTS=1 npx playwright test --project=chromium tests/e2e/screenshots.spec.ts
 */
test.skip(!process.env["SHOTS"], "set SHOTS=1 to capture screenshots");
test.skip(({ browserName }) => browserName !== "chromium", "captured on Chromium only");

const DIR = "docs/screenshots";

test.beforeAll(() => {
  mkdirSync(DIR, { recursive: true });
});

async function settle(page: import("@playwright/test").Page, ms = 400): Promise<void> {
  await page.waitForTimeout(ms);
}

test("01 title", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__snake !== "undefined");
  await useTier(page, "ultra");
  await settle(page, 600);
  await page.screenshot({ path: `${DIR}/01-title.png` });
  expect(true).toBe(true);
});

test("02 play L1 / 03 L2 theme / 04 pause", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await ready(page);
  await useTier(page, "ultra");
  await page.evaluate(() => window.__snake.foodAhead());
  await settle(page, 500);
  await page.screenshot({ path: `${DIR}/02-play-l1.png` });
  await page.evaluate(() => window.__snake.addScore(150));
  await page.waitForFunction(() => window.__snake.theme().name === "neon-magenta" && window.__snake.theme().settled, null, { timeout: 3000 });
  await page.keyboard.press("KeyR");
  await page.waitForFunction(() => window.__snake.restarts() === 1);
  await page.evaluate(() => window.__snake.addScore(150));
  await page.waitForFunction(() => window.__snake.theme().settled && window.__snake.theme().name === "neon-magenta", null, { timeout: 3000 });
  await page.evaluate(() => window.__snake.foodAhead());
  await settle(page, 250);
  await page.screenshot({ path: `${DIR}/03-play-l2-theme.png` });
  await page.keyboard.press("KeyP");
  await page.waitForFunction(() => window.__snake.state().phase === "paused");
  await settle(page, 200);
  await page.screenshot({ path: `${DIR}/04-pause.png` });
});

test("05 wall death FX / 06 gameover", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await ready(page);
  await useTier(page, "ultra");
  await page.evaluate(() => window.__snake.forceDeath("wall"));
  await page.waitForFunction(() => window.__snake.state().phase === "gameover", null, { timeout: 3000 });
  await settle(page, 120);
  await page.screenshot({ path: `${DIR}/05-wall-death-fx.png` });
  await settle(page, 1200);
  await page.screenshot({ path: `${DIR}/06-gameover.png` });
});

test("07 ultra 1080p L1 / 08 ultra 1080p L3", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await ready(page);
  await useTier(page, "ultra");
  await page.evaluate(() => window.__snake.foodAhead());
  await settle(page, 500);
  await page.screenshot({ path: `${DIR}/07-ultra-1080p-l1.png` });
  // Level 3 ticks fast: pause right after the re-tint so the shot shows play, not a death.
  await page.keyboard.press("KeyR");
  await page.waitForFunction(() => window.__snake.restarts() === 1);
  await page.evaluate(() => window.__snake.addScore(400));
  await page.waitForFunction(() => window.__snake.theme().name === "electric-violet" && window.__snake.theme().settled, null, { timeout: 3000 });
  await page.evaluate(() => window.__snake.foodAhead());
  await settle(page, 200);
  await page.evaluate(() => window.__snake.freeze());
  await settle(page, 100);
  await page.screenshot({ path: `${DIR}/08-ultra-1080p-l3.png` });
  await page.evaluate(() => window.__snake.unfreeze());
  await ctx.close();
});
