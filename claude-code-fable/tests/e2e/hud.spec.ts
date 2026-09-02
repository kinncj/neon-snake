import { test, expect } from "@playwright/test";
import { ready, snakeState } from "./snake-debug";

test("the title overlay holds the simulation until the first move", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__snake !== "undefined");
  await expect(page.locator("#overlay")).toBeVisible();
  expect(await page.evaluate(() => window.__snake.uiMode())).toBe("title");
  await page.waitForTimeout(400);
  expect((await snakeState(page)).tick).toBe(0);
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => window.__snake.state().tick > 0);
  await expect(page.locator("#overlay")).toBeHidden();
  expect(await page.evaluate(() => window.__snake.uiMode())).toBe("playing");
});

test.describe("in play", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await ready(page);
  });

  test("score, level and combo update from state and a +N popup appears on eat", async ({ page }) => {
    await expect(page.locator("#hud-score")).toHaveText("0");
    await expect(page.locator("#hud-level")).toHaveText("Level 1");
    await expect(page.locator("#hud-combo")).toBeHidden();
    await page.evaluate(() => window.__snake.foodAhead());
    await page.waitForFunction(() => window.__snake.state().score > 0);
    await expect(page.locator("#hud-score")).toHaveText("10");
    await expect(page.locator("#popups .popup.live").first()).toHaveText("+10");
    // Chain a second eat inside the combo window.
    await page.evaluate(() => window.__snake.foodAhead());
    await page.waitForFunction(() => window.__snake.state().score >= 30);
    await expect(page.locator("#hud-combo")).toHaveText("×2 combo");
  });

  test("the pause overlay follows the phase", async ({ page }) => {
    await page.keyboard.press("KeyP");
    await page.waitForFunction(() => window.__snake.state().phase === "paused");
    await expect(page.locator("#overlay")).toBeVisible();
    await expect(page.locator("#ov-title")).toHaveText("Paused");
    await page.keyboard.press("KeyP");
    await expect(page.locator("#overlay")).toBeHidden();
  });

  test("the level-up banner and MAX state", async ({ page }) => {
    await page.evaluate(() => window.__snake.addScore(150));
    await page.waitForFunction(() => window.__snake.state().level === 2);
    await expect(page.locator("#hud-level")).toHaveText("Level 2");
    await expect(page.locator("#banner")).toBeVisible();
    await expect(page.locator("#banner")).toHaveText("Level 2");
    await page.evaluate(() => window.__snake.addScore(2000));
    await page.waitForFunction(() => window.__snake.state().level === 5);
    await expect(page.locator("#hud-level")).toHaveText("MAX");
  });

  test("gameover shows the final score, the cause and updates best", async ({ page }) => {
    await page.evaluate(() => window.__snake.addScore(70));
    await page.evaluate(() => window.__snake.forceDeath("wall"));
    await page.waitForFunction(() => window.__snake.state().phase === "gameover");
    await expect(page.locator("#overlay")).toBeVisible();
    await expect(page.locator("#ov-title")).toHaveText("Game over");
    await expect(page.locator("#ov-sub")).toHaveText("Hit the wall");
    await expect(page.locator("#ov-body")).toContainText("Score 70");
    await expect(page.locator("#ov-body")).toContainText("New best!");
    await expect(page.locator("#hud-best")).toHaveText("70");
    await page.keyboard.press("KeyR");
    await page.waitForFunction(() => window.__snake.state().phase === "playing");
    await expect(page.locator("#overlay")).toBeHidden();
    await expect(page.locator("#hud-best")).toHaveText("70");
    await expect(page.locator("#hud-score")).toHaveText("0");
  });

  test("a self-bite reports its own cause", async ({ page }) => {
    await page.evaluate(() => window.__snake.forceDeath("self"));
    await page.waitForFunction(() => window.__snake.state().phase === "gameover");
    await expect(page.locator("#ov-sub")).toHaveText("Bit yourself");
  });
});
