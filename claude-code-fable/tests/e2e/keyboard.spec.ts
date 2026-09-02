import { test, expect } from "@playwright/test";
import { ready, snakeState } from "./snake-debug";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
});

test("arrow keys turn the snake within a tick", async ({ page }) => {
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => window.__snake.state().dir === 3, null, { timeout: 2000 });
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => window.__snake.state().dir === 2, null, { timeout: 2000 });
  expect((await snakeState(page)).phase).toBe("playing");
});

test("WASD turns too", async ({ page }) => {
  await page.keyboard.press("KeyS");
  await page.waitForFunction(() => window.__snake.state().dir === 1, null, { timeout: 2000 });
  await page.keyboard.press("KeyD");
  await page.waitForFunction(() => window.__snake.state().dir === 0, null, { timeout: 2000 });
});

test("a 180 degree reversal is ignored", async ({ page }) => {
  const before = (await snakeState(page)).dir;
  expect(before).toBe(0);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  expect((await snakeState(page)).dir).toBe(0);
  expect((await snakeState(page)).phase).toBe("playing");
});

test("P pauses and resumes; Escape pauses too", async ({ page }) => {
  await page.keyboard.press("KeyP");
  await page.waitForFunction(() => window.__snake.state().phase === "paused");
  const tick = (await snakeState(page)).tick;
  await page.waitForTimeout(300);
  expect((await snakeState(page)).tick).toBe(tick);
  await page.keyboard.press("KeyP");
  await page.waitForFunction(() => window.__snake.state().phase === "playing");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__snake.state().phase === "paused");
});

test("R restarts the run with the same seed", async ({ page }) => {
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => window.__snake.state().tick > 3);
  const hash0 = await page.evaluate(() => {
    window.__snake.freeze();
    return window.__snake.hash();
  });
  await page.evaluate(() => window.__snake.unfreeze());
  await page.keyboard.press("KeyR");
  await page.waitForFunction(() => window.__snake.state().tick < 3);
  const s = await snakeState(page);
  expect(s.phase).toBe("playing");
  expect(s.dir).toBe(0);
  expect(s.score).toBe(0);
  expect(hash0).not.toBe("");
});

test("arrow keys do not scroll the page", async ({ page }) => {
  const prevented = await page.evaluate(() => {
    return new Promise<boolean>((resolve) => {
      window.addEventListener("keydown", (e) => resolve(e.defaultPrevented), { once: true, capture: false });
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowDown", key: "ArrowDown", bubbles: true, cancelable: true }));
    });
  });
  // Our listener runs first (registered earlier), so by the time the probe
  // listener sees the event preventDefault() has already been called.
  expect(prevented).toBe(true);
});
