/**
 * Playtest capture: a scripted playthrough that saves screenshots to
 * docs/screenshots/ for the build report. Opt-in (SHOTS=1) so CI runs
 * stay fast and the repo only gains captures on demand.
 *
 *   SHOTS=1 npx playwright test --project=chromium tests/e2e/screenshots.spec.ts
 */
import { test } from "@playwright/test";
import { play } from "./snake-debug";

const SHOT = process.env.SHOTS === "1";
test.skip(!SHOT, "set SHOTS=1 to capture playtest screenshots");

const DIR = "docs/screenshots";

async function snap(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: false });
}

test("playthrough: title, L1 play, L2 theme shift, pause, wall death", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
  await page.waitForTimeout(900); // let the title settle (logo flicker)
  await snap(page, "01-title");

  // start + eat one apple: juice, popup, glow. Steer up so the snake
  // walks away from the right wall during the settle waits.
  await page.evaluate(() => window.__snake!.ui.start());
  await page.waitForFunction(() => window.__snake!.state.phase === "playing");
  await page.evaluate(() => window.__snake!.fx.teleportFoodAhead());
  await page.waitForFunction(() => window.__snake!.state.score > 0);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(180); // mid-burst
  await snap(page, "02-play-l1");

  // level 2: theme shifts to magenta, song switches; steer left away
  // from the wall so the 600ms transition wait is safe
  await page.evaluate(() => {
    window.__snake!.bumpScore(140);
    window.__snake!.fx.teleportFoodAhead();
  });
  await page.waitForFunction(() => window.__snake!.state.level === 2);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(1100); // let the 600ms theme transition settle
  await snap(page, "03-play-l2-theme");

  // pause overlay
  await page.keyboard.press("p");
  await page.waitForFunction(() => window.__snake!.state.phase === "paused");
  await page.waitForTimeout(200);
  await snap(page, "04-pause");
  await page.keyboard.press("p");
  await page.waitForFunction(() => window.__snake!.state.phase === "playing");

  // wall death: explosion + shake, then the gameover panel
  await page.evaluate(() => window.__snake!.fx.forceDeath());
  await page.waitForFunction(
    () => window.__snake!.fx.info().shakeActive,
    undefined,
    { timeout: 2000 }
  );
  await page.waitForTimeout(90); // catch the sparks mid-flight
  await snap(page, "05-wall-death-fx");
  await page.waitForFunction(() => window.__snake!.state.phase === "gameover");
  await page.waitForTimeout(400);
  await snap(page, "06-gameover");
});

test("wide 1920x1080 viewport, L1 and L3 themes", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await play(page);
  await page.evaluate(() => window.__snake!.fx.forceTier("ultra"));
  await page.waitForFunction(() => window.__snake!.fx.info().tier === "ultra");
  await page.waitForTimeout(600);
  await snap(page, "07-ultra-1080p-l1");

  // push to level 3 (violet)
  await page.evaluate(() => {
    window.__snake!.bumpScore(400);
    window.__snake!.fx.teleportFoodAhead();
  });
  await page.waitForFunction(() => window.__snake!.state.level === 3);
  await page.waitForTimeout(1100);
  await snap(page, "08-ultra-1080p-l3");
});
