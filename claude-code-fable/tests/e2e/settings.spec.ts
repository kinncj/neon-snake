import { test, expect } from "@playwright/test";
import { ready, snakeState } from "./snake-debug";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await ready(page);
});

test("the gear opens a pause-on-open modal; Escape, backdrop and close all close it", async ({ page }) => {
  await expect(page.locator("#settings")).toBeHidden();
  await page.locator("#gear").click();
  await expect(page.locator("#settings-panel")).toBeVisible();
  await expect(page.locator("#settings-title")).toHaveText("Settings");
  await page.waitForFunction(() => window.__snake.state().phase === "paused");
  const tick = (await snakeState(page)).tick;
  // Arrow keys are swallowed while the panel is open: the game must not steer.
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(150);
  expect((await snakeState(page)).dir).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings")).toBeHidden();
  expect((await snakeState(page)).phase).toBe("paused"); // stays paused until the player resumes
  expect((await snakeState(page)).tick).toBe(tick);
  await page.locator("#gear").click();
  await expect(page.locator("#settings-panel")).toBeVisible();
  await page.locator(".settings-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#settings")).toBeHidden();
  await page.locator("#gear").click();
  await page.locator("#settings-close").click();
  await expect(page.locator("#settings")).toBeHidden();
});

test("defaults: effects and sound on, d-pad and fps off; toggles persist across reloads", async ({ page }) => {
  await page.locator("#gear").click();
  await expect(page.locator("#toggle-effects")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#toggle-sound")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#toggle-dpad")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#toggle-fps")).toHaveAttribute("aria-checked", "false");
  await page.locator("#toggle-dpad").click();
  await page.locator("#toggle-fps").click();
  await page.locator("#toggle-sound").click();
  await expect(page.locator("#dpad")).toBeVisible();
  await expect(page.locator("#fps")).toBeVisible();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("snake.settings") ?? "{}"));
  expect(stored).toEqual({ effects: true, sound: false, dpad: true, fps: true });
  await page.reload();
  await ready(page);
  await expect(page.locator("#dpad")).toBeVisible();
  await expect(page.locator("#fps")).toBeVisible();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#gear").click();
  await expect(page.locator("#toggle-sound")).toHaveAttribute("aria-checked", "false");
});

test("Effects off forces the reduced tier and overrides the governor; on restores it", async ({ page }) => {
  await page.locator("#gear").click();
  await page.locator("#toggle-effects").click();
  expect(await page.evaluate(() => window.__snake.tier())).toBe("reduced");
  await page.evaluate(() => window.__snake.setTier("ultra"));
  await page.evaluate(() => window.__snake.setTier(null));
  expect(await page.evaluate(() => window.__snake.tier())).toBe("reduced");
  await page.locator("#toggle-effects").click();
  expect(await page.evaluate(() => window.__snake.tier())).not.toBe("reduced");
});

test("the panel is translated", async ({ page }) => {
  await page.goto("/?lang=es");
  await page.waitForFunction(() => typeof window.__snake !== "undefined");
  await page.locator("#gear").click();
  await expect(page.locator("#settings-title")).toHaveText("Ajustes");
  await expect(page.locator("#settings-label-effects")).toHaveText("Efectos");
  await expect(page.locator("#toggle-dpad .settings-state")).toHaveText("No");
  await expect(page.locator("#settings-close")).toHaveText("Cerrar");
});

test("the FPS meter reports frames and the mute button and Sound toggle stay in sync", async ({ page }) => {
  await page.locator("#gear").click();
  await page.locator("#toggle-fps").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("KeyP"); // resume
  await page.waitForFunction(() => /\d+ fps/.test(document.getElementById("fps")!.textContent ?? ""), null, { timeout: 3000 });
  await page.keyboard.press("KeyM");
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#gear").click();
  await expect(page.locator("#toggle-sound")).toHaveAttribute("aria-checked", "false");
});
