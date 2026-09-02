import { test, expect } from "@playwright/test";
import { ready } from "./snake-debug";

test.skip(({ browserName }) => browserName === "webkit", "headless WebKit has no audio output pipeline");

test.beforeEach(async ({ page }) => {
  // Count every AudioContext construction from before the app's script runs.
  await page.addInitScript(() => {
    const w = window as unknown as { __audioContexts: number; AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    w.__audioContexts = 0;
    const wrap = (Ctor: typeof AudioContext): typeof AudioContext => {
      const P = new Proxy(Ctor, {
        construct(target, args) {
          w.__audioContexts++;
          return Reflect.construct(target, args);
        }
      });
      return P;
    };
    if (w.AudioContext) w.AudioContext = wrap(w.AudioContext);
    if (w.webkitAudioContext) w.webkitAudioContext = wrap(w.webkitAudioContext);
  });
  await page.goto("/");
  await ready(page);
});

const contexts = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts);

test("no AudioContext exists before a user gesture", async ({ page }) => {
  await page.waitForTimeout(800);
  expect(await contexts(page)).toBe(0);
  expect(await page.evaluate(() => window.__snake.audio().contextCreated)).toBe(false);
});

test("the first gesture creates the context and SFX play from the effect stream", async ({ page }) => {
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => window.__snake.audio().enabled, null, { timeout: 10_000 });
  expect(await contexts(page)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__snake.audio().contextCreated)).toBe(true);
  // A deterministic death: freeze, stage the wall collision, unfreeze.
  await page.evaluate(() => {
    window.__snake.freeze();
    window.__snake.forceDeath("wall");
    window.__snake.unfreeze();
  });
  await page.waitForFunction(() => window.__snake.state().phase === "gameover", null, { timeout: 3000 });
  await page.waitForFunction(() => window.__snake.audio().lastSfx !== "", null, { timeout: 2000 });
  const a = await page.evaluate(() => window.__snake.audio());
  expect(["boom", "gameover"]).toContain(a.lastSfx);
  expect(a.voiceSum).toBeLessThanOrEqual(0.8 + 1e-6);
});

test("mute is a labelled, keyboard-reachable control and persists", async ({ page }) => {
  const btn = page.locator("#mute");
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute("aria-label", /sound|mute/i);
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await btn.focus();
  await page.keyboard.press("Enter");
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("snake.audio"))).toBe("off");
  await page.reload();
  await ready(page);
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("KeyM");
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "false");
});

test("the context suspends when the page is hidden", async ({ page }) => {
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => window.__snake.audio().enabled, null, { timeout: 10_000 });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(() => window.__snake.audio().contextState === "suspended", null, { timeout: 3000 });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(() => window.__snake.audio().contextState === "running", null, { timeout: 3000 });
});

test("a level-up crossfades to the next song and a restart returns to the first", async ({ page }) => {
  await page.keyboard.press("Shift"); // a gesture that does not steer
  await page.waitForFunction(() => window.__snake.audio().enabled, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__snake.audio().song === "cozy-bedroom", null, { timeout: 3000 });
  // Restart (a fresh snake with plenty of ticks of life ahead) and wait for the
  // restart intent to be applied before bumping the score.
  await page.keyboard.press("KeyR");
  await page.waitForFunction(() => window.__snake.restarts() === 1);
  await page.evaluate(() => window.__snake.addScore(150));
  await page.waitForFunction(() => window.__snake.audio().song === "window-seat", null, { timeout: 3000 });
  await page.keyboard.press("KeyR");
  await page.waitForFunction(() => window.__snake.restarts() === 2);
  await page.waitForFunction(() => window.__snake.audio().song === "cozy-bedroom", null, { timeout: 3000 });
  await page.evaluate(() => window.__snake.addScore(1500));
  try {
    await page.waitForFunction(() => window.__snake.audio().song === "skyline-view", null, { timeout: 3000 });
  } catch (e) {
    const a = await page.evaluate(() => ({ audio: window.__snake.audio(), state: window.__snake.state() }));
    throw new Error("song did not change: " + JSON.stringify(a), { cause: e });
  }
});
