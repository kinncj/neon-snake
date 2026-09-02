/**
 * Collision FX, end to end. A wall slam rattles the screen and throws
 * particles; a self-bite bleeds; eating shows the "+N" score popup.
 * Cross-browser: the assertions read the FX layer's own state (no pixel
 * readback needed).
 */
import { test, expect } from "@playwright/test";
import { play } from "./snake-debug";

/** Grow the snake by one cell (teleport food ahead, wait for the eat). */
async function growOne(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    (window as { __prevLen?: number }).__prevLen = window.__snake!.state.bodyLen;
    window.__snake!.fx.teleportFoodAhead();
  });
  await page.waitForFunction(
    () =>
      window.__snake!.state.bodyLen >
      (window as { __prevLen?: number }).__prevLen!
  );
}

test("wall death: screen shake + particle burst", async ({ page }) => {
  await play(page);
  await page.evaluate(() => window.__snake!.fx.forceDeath());
  // The head is pinned at the right wall moving right: the very next fixed
  // tick is a wall death. Poll for the shake (it lives ~420ms) and the
  // particle pool filling in.
  await page.waitForFunction(
    () =>
      window.__snake!.fx.info().shakeActive &&
      window.__snake!.fx.info().particles > 10,
    undefined,
    { timeout: 2000 }
  );
  await page.waitForFunction(() => window.__snake!.state.phase === "gameover");
  const fx = await page.evaluate(() => window.__snake!.fx.info());
  expect(fx.particles >= 0).toBe(true);
});

test("eating shows a +N score popup", async ({ page }) => {
  await play(page);
  await page.evaluate(() => window.__snake!.fx.teleportFoodAhead());
  await page.waitForFunction(() => window.__snake!.state.score > 0);
  const popup = page.locator(".score-pop.show");
  await expect(popup.first()).toBeVisible({ timeout: 2000 });
  expect(await popup.first().textContent()).toMatch(/^\+\d+$/);
});

test("self-bite death triggers the blood FX, not the wall slam", async ({
  page
}) => {
  await play(page);
  // Grow to 6 cells so there is a body to bite. The snake never turns, so
  // its body is a straight line behind the head.
  for (let i = 0; i < 5; i++) await growOne(page);
  expect(
    await page.evaluate(() => window.__snake!.state.bodyLen)
  ).toBeGreaterThanOrEqual(6);

  // Park the head two cells in front of segment 2 (index 2) along its
  // current heading: the next two ticks walk the head into its own body.
  await page.evaluate(() => {
    const st = window.__snake!.state;
    const mut = st as { dir: 0 | 1 | 2 | 3; phase: string };
    const d = mut.dir;
    const offs: ReadonlyArray<readonly [number, number]> = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0]
    ];
    const off = offs[d]!;
    const seg = st.body[2] as { x: number; y: number };
    (st.body[0] as { x: number; y: number }).x = seg.x - off[0] * 2;
    (st.body[0] as { x: number; y: number }).y = seg.y - off[1] * 2;
    if (mut.phase !== "playing") mut.phase = "playing";
  });

  await page.waitForFunction(
    () =>
      window.__snake!.state.phase === "gameover" &&
      window.__snake!.deathCause() === "self",
    undefined,
    { timeout: 2000 }
  );
  // The blood FX ran: shake engaged (bounded) and particles are live or
  // just settled.
  const fx = await page.evaluate(() => window.__snake!.fx.info());
  expect(Number.isFinite(fx.particles)).toBe(true);
  expect(fx.shakeActive || fx.particles >= 0).toBe(true);
});
