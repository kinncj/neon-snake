import { expect, test } from "@playwright/test";
import { play } from "./snake-debug";

async function ready(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
}

/**
 * Poll the live state until `expr` holds. Runs in the page, so it also
 * waits for the fixed-tick loop to drain the input queue (intents apply at
 * most once per 120ms tick).
 */
async function settle(page: import("@playwright/test").Page, expr: string): Promise<void> {
  await page.waitForFunction(expr, null, { timeout: 2000 });
}

test("arrows and WASD queue turns; the cap and rejection rules hold", async ({ page }) => {
  // The game boots behind the title screen; start it, then freeze so the
  // turn-queue assertions are deterministic.
  await play(page);
  await page.evaluate(() => window.__snake!.freeze());

  // Initial dir is right (1). Up is legal and queues.
  await page.keyboard.press("ArrowUp");
  await settle(page, "window.__snake.state.pendingLen === 1");

  // Same direction again: no-op turn, rejected.
  await page.keyboard.press("KeyW");
  await page.waitForTimeout(150); // at least one tick has drained
  await settle(page, "window.__snake.state.pendingLen === 1");

  // 180 opposite of the last pending (up -> down): rejected.
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  await settle(page, "window.__snake.state.pendingLen === 1");

  // A legal second turn (up -> left) queues.
  await page.keyboard.press("KeyA");
  await settle(page, "window.__snake.state.pendingLen === 2");

  // A third turn overflows the MAX_PENDING=2 cap and is dropped.
  await page.keyboard.press("KeyD");
  await page.waitForTimeout(150);
  await settle(page, "window.__snake.state.pendingLen === 2");

  // Resume: the buffered turns execute one per tick (up, then left).
  const before = await page.evaluate(() => {
    const b = window.__snake!.state.body[0]!;
    return { x: b.x, y: b.y };
  });
  await page.evaluate(() => window.__snake!.unfreeze());
  await settle(
    page,
    `window.__snake.state.body[0].x === ${before.x - 1} && window.__snake.state.body[0].y === ${before.y - 1}`
  );
});

test("P and Escape toggle pause, R restarts", async ({ page }) => {
  await ready(page);

  await page.keyboard.press("KeyP");
  await settle(page, "window.__snake.state.phase === 'paused'");

  await page.keyboard.press("Escape");
  await settle(page, "window.__snake.state.phase === 'playing'");

  // Let several ticks run, then pause and restart.
  await settle(page, "window.__snake.state.tick >= 4");
  await page.evaluate(() => window.__snake!.freeze());
  const tickBeforeRestart = await page.evaluate(() => window.__snake!.state.tick);
  expect(tickBeforeRestart).toBeGreaterThanOrEqual(4);

  await page.keyboard.press("KeyR");
  await settle(page, "window.__snake.state.phase === 'playing' && window.__snake.state.tick < 3 && window.__snake.state.bodyLen === 3");
});

test("arrows and space are preventDefaulted, letters are not", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    (window as unknown as { __pd: Record<string, boolean> }).__pd = {};
    window.addEventListener(
      "keydown",
      (e) => {
        (window as unknown as { __pd: Record<string, boolean> }).__pd[e.code] = e.defaultPrevented;
      },
    );
  });
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await page.keyboard.press("KeyP");
  const pd = await page.evaluate(() => (window as unknown as { __pd: Record<string, boolean> }).__pd);
  expect(pd["ArrowUp"]).toBe(true);
  expect(pd["Space"]).toBe(true);
  expect(pd["KeyP"]).toBe(false);
});
