import type { Page } from "@playwright/test";

/**
 * Shared e2e helpers. The game boots paused behind a title screen (step 19),
 * so a test that needs the sim actually running must clear the title first.
 */

/** Load the app, clear the title screen, and wait until the sim is running. */
export async function play(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
  await page.evaluate(() => window.__snake!.ui.start());
  await page.waitForFunction(() => window.__snake!.state.phase === "playing");
}
