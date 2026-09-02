import { test, expect } from "@playwright/test";
import { ready } from "./snake-debug";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await ready(page);
});

test("the CRT shell frames the game: bezel above the screen, pointer-transparent, LED breathing", async ({ page }) => {
  const frame = page.locator("#tv-frame");
  await expect(frame).toBeVisible();
  const cs = await page.evaluate(() => {
    const f = getComputedStyle(document.getElementById("tv-frame")!);
    const led = getComputedStyle(document.getElementById("tv-led")!);
    return { z: f.zIndex, pe: f.pointerEvents, ledAnim: led.animationName, ledDur: led.animationDuration };
  });
  expect(Number(cs.z)).toBe(40);
  expect(cs.pe).toBe("none");
  expect(cs.ledAnim).not.toBe("none");
  expect(parseFloat(cs.ledDur)).toBeGreaterThan(1);
});

test("the glass holds the canvases and the HUD is inset to clear the bezel", async ({ page }) => {
  const screen = (await page.locator("#screen").boundingBox())!;
  const tv = (await page.locator("#tv").boundingBox())!;
  expect(screen.x).toBeGreaterThan(tv.x + 8);
  expect(screen.y).toBeGreaterThan(tv.y + 8);
  expect(screen.x + screen.width).toBeLessThan(tv.x + tv.width - 8);
  expect(screen.y + screen.height).toBeLessThan(tv.y + tv.height - 8);
  const display = (await page.locator("#display").boundingBox())!;
  expect(Math.abs(display.x - screen.x)).toBeLessThan(1);
  expect(Math.abs(display.width - screen.width)).toBeLessThan(1);
  const hud = (await page.locator("#hud").boundingBox())!;
  expect(hud.x).toBeGreaterThanOrEqual(screen.x - 1);
  expect(hud.y).toBeGreaterThanOrEqual(screen.y - 1);
  const inside = await page.evaluate(() => document.getElementById("screen")!.contains(document.getElementById("display")!) && document.getElementById("screen")!.contains(document.getElementById("fx")!));
  expect(inside).toBe(true);
});

test("keyboard input still reaches the game through the bezel", async ({ page }) => {
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => window.__snake.state().dir === 3, null, { timeout: 2000 });
  const build = await page.locator("#build").textContent();
  expect(build && build.length > 0).toBe(true);
});
