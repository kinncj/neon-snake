import { test, expect } from "@playwright/test";
import { ready, useTier } from "./snake-debug";

/**
 * Browser-side frame budget: 600 sampled frames at `low` under a 4x CPU
 * throttle, p95 < 16.7 ms. CPU throttling is a CDP feature, so this runs
 * on Chromium only and self-skips elsewhere.
 */
test.skip(({ browserName }) => browserName !== "chromium", "CPU throttling needs CDP (Chromium)");

test("p95 frame time at low under 4x CPU throttle is under 16.7 ms", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await ready(page);
  await useTier(page, "low");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  // Keep the snake alive and moving by restarting on death while sampling.
  const times = await page.evaluate(async () => {
    const start = window.__snake.frameCount();
    const out: number[] = [];
    while (window.__snake.frameCount() - start < 620) {
      await new Promise((r) => requestAnimationFrame(r));
      if (window.__snake.state().phase === "gameover") {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR", key: "r", bubbles: true }));
      }
    }
    const ft = window.__snake.frameWork();
    for (const t of ft) out.push(t);
    return out;
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  expect(times.length).toBeGreaterThanOrEqual(600);
  // frameWork() is the CPU time of the loop body per frame (tick + draw +
  // composite), which is what the budget governs; the RAF gap itself is
  // pinned to the display period by the browser.
  const sorted = times.slice(-600).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  expect(p95).toBeLessThan(16.7);
});

test("time to interactive: the game is ticking within 1.5 s of navigation", async ({ page }) => {
  const t0 = Date.now();
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__snake !== "undefined" && window.__snake.state().tick >= 1);
  expect(Date.now() - t0).toBeLessThan(1500);
});
