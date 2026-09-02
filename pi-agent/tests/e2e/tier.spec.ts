import { expect, test } from "@playwright/test";
import "./snake-debug";

const DISPLACEMENT = ["curvature", "chromatic", "shockwave", "deathblur"];

async function ready(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
}

test("prefers-reduced-motion forces reduced over a pinned ultra; no displacement pass", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);

  await page.evaluate(() => window.__snake!.tier.pinPerf("ultra"));
  const perf = await page.evaluate(() => window.__snake!.tier.perf());
  const effective = await page.evaluate(() => window.__snake!.tier.effective());
  const passes = await page.evaluate(() => window.__snake!.tier.passes());

  // the performance heuristic is pinned to ultra...
  expect(perf).toBe("ultra");
  // ...but the reduced-motion preference overrides it as the effective tier
  expect(effective).toBe("reduced");
  // and no displacement/warp/dissolve pass is configured to run
  for (const p of DISPLACEMENT) expect(passes).not.toContain(p);
});

test("without reduced motion, a pinned ultra is effective", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await ready(page);

  await page.evaluate(() => window.__snake!.tier.pinPerf("ultra"));
  const effective = await page.evaluate(() => window.__snake!.tier.effective());
  expect(effective).toBe("ultra");

  // the settings "Effects" toggle flips the effective tier to reduced and
  // persists it
  await page.click("#settings-gear");
  await page.click('.settings-row[data-key="fx"]');
  expect(await page.evaluate(() => window.__snake!.tier.effective())).toBe("reduced");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("snake.settings")!).fx)).toBe(false);

  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => window.__snake!.tier.effective())).toBe("reduced");
});
