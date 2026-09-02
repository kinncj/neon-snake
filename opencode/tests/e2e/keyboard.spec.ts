import { expect, test } from "@playwright/test";

/**
 * Keyboard gameplay: arrows/WASD steer, P pause, R restart. The simulation
 * is observed through the window.__snake debug API. Intents take effect on
 * the next fixed tick, so every assertion waits for its observable effect
 * instead of racing the loop.
 */

test("keyboard: turn up, pause toggle, and restart", async ({ page }) => {
  await page.goto("/");

  // Restart to a fresh, known state (head at centre, facing right).
  await page.evaluate(() => window.__snake!.restart());
  await page.waitForFunction(
    () => window.__snake!.head().y === 15,
    undefined,
    { timeout: 2000 }
  );

  // Steer up. Whatever tick the turn lands on, the snake ends up above the
  // centre row and at most one column right of the start.
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(
    () => window.__snake!.head().y < 15,
    undefined,
    { timeout: 2000 }
  );
  const head = await page.evaluate(() => window.__snake!.head());
  expect(head.y).toBeLessThan(15);
  expect(head.x).toBeGreaterThanOrEqual(16);
  expect(head.x).toBeLessThanOrEqual(17);

  // Pause toggle (P): paused -> playing -> paused.
  await page.evaluate(() => window.__snake!.pause());
  await page.keyboard.press("p");
  await page.waitForFunction(
    () => window.__snake!.phase() === "playing",
    undefined,
    { timeout: 2000 }
  );
  await page.keyboard.press("p");
  await page.waitForFunction(
    () => window.__snake!.phase() === "paused",
    undefined,
    { timeout: 2000 }
  );

  // Restart (R): the snake returns to the centre row with a fresh body and
  // no score.
  await page.keyboard.press("r");
  await page.waitForFunction(
    () => {
      const s = window.__snake!;
      return s.score() === 0 && s.bodyLen() === 3 && s.head().y === 15;
    },
    undefined,
    { timeout: 2000 }
  );
  const after = await page.evaluate(() => ({
    head: window.__snake!.head(),
    score: window.__snake!.score(),
    bodyLen: window.__snake!.bodyLen()
  }));
  expect(after.head.y).toBe(15);
  expect(after.head.x).toBeGreaterThanOrEqual(16);
  expect(after.head.x).toBeLessThanOrEqual(17);
  expect(after.score).toBe(0);
  expect(after.bodyLen).toBe(3);
});

test("keyboard: WASD steers like the arrows", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.__snake!.restart());
  await page.waitForFunction(
    () => window.__snake!.head().y === 15,
    undefined,
    { timeout: 2000 }
  );
  await page.keyboard.press("w"); // up
  await page.waitForFunction(
    () => window.__snake!.head().y < 15,
    undefined,
    { timeout: 2000 }
  );
});
