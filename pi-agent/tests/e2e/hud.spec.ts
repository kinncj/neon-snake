import { expect, test } from "@playwright/test";
import { play } from "./snake-debug";

/**
 * HUD: DOM counters sync from state, banners fire on domain events, strings
 * come from the i18n catalog, and the high score survives a reload.
 */
const ready = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.goto("http://127.0.0.1:4173/");
  await page.waitForFunction(() => window.__snake !== undefined);
};

test("HUD counters follow the score (en)", async ({ page }) => {
  await play(page);
  await page.evaluate(() => window.__snake!.fx.teleportFoodAhead());
  await page.waitForFunction(() => window.__snake!.state.score > 0);
  const score = page.locator("#hud-score-value");
  await expect(score).toHaveText(
    (await page.evaluate(() => window.__snake!.state.score)).toString()
  );
  // length counter shows the snake length
  await expect(page.locator("#hud-length-value")).toHaveText(
    (await page.evaluate(() => window.__snake!.state.bodyLen)).toString()
  );
});

test("footer hint swaps after the first input", async ({ page }) => {
  await ready(page);
  await expect(page.locator("#footer")).toHaveText("PRESS ANY KEY OR TAP TO START");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#footer")).toHaveText(
    "ARROWS / WASD MOVE - P PAUSE - R RESTART"
  );
});

test("pause banners PAUSED via the P key", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("p");
  await expect(page.locator("#banner")).toHaveClass(/show/);
  await expect(page.locator("#banner")).toHaveText("PAUSED");
  await page.keyboard.press("p");
  await page.waitForFunction(() => window.__snake!.state.phase === "playing");
});

test("level-up banner shows LEVEL 2 when the threshold is crossed", async ({
  page
}) => {
  await play(page);
  // One apple (10 pts, combo >= 1) puts 140 over the 150 threshold.
  await page.evaluate(() => {
    window.__snake!.bumpScore(140);
    window.__snake!.fx.teleportFoodAhead();
  });
  await page.waitForFunction(() => window.__snake!.state.level === 2);
  await expect(page.locator("#banner")).toHaveText("LEVEL 2");
});

test.describe("Japanese locale localises the HUD", () => {
  test.use({ locale: "ja-JP" });
  test("labels and title", async ({ page }) => {
    await ready(page);
    await expect(page.locator("#hud-score-label")).toHaveText("スコア");
    await expect(page.locator("#hud-level-label")).toHaveText("レベル");
    expect(await page.title()).toBe("ネオン スネーク");
  });
});

test.describe("Spanish locale localises the HUD", () => {
  test.use({ locale: "es-419" });
  test("labels and title", async ({ page }) => {
    await ready(page);
    await expect(page.locator("#hud-score-label")).toHaveText("PUNTOS");
    expect(await page.title()).toBe("SNAKE NEÓN");
  });
});

test("high score persists across a reload", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.__snake!.ui.start());
  await page.waitForFunction(() => window.__snake!.state.phase === "playing");
  await page.evaluate(() => window.__snake!.fx.teleportFoodAhead());
  await page.waitForFunction(() => window.__snake!.state.score > 0);
  await page.evaluate(() => window.__snake!.fx.forceDeath());
  await page.waitForFunction(() => window.__snake!.state.phase === "gameover");
  // game-over banner shows, then — for a new best — the new-best banner
  await expect(page.locator("#banner")).toHaveText("GAME OVER");
  await expect(page.locator("#banner")).toHaveText("NEW BEST!", {
    timeout: 4000
  });
  await page.reload();
  await page.waitForFunction(() => window.__snake !== undefined);
  await expect(page.locator("#hud-best-value")).toHaveText(
    (await page.evaluate(() => window.__snake!.state.best)).toString()
  );
  expect(await page.evaluate(() => window.__snake!.state.best)).toBeGreaterThan(0);
});
