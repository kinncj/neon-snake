import { expect, test } from "@playwright/test";

/**
 * Quality-tier wiring: a capability probe at boot picks the start tier, the
 * governor de/escalates on a rolling frame-time median (unit-tested in
 * tests/unit/quality.test.ts), and prefers-reduced-motion forces the reduced
 * tier. Verified through the window.__snake debug bridge.
 */

const TIERS = ["low", "high", "ultra", "reduced"];

test("the governor reports a valid tier and responds to pins", async ({
  page
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
  // Normalise the reduced override so the pin assertions hold on any host.
  await page.evaluate(() => window.__snake!.setReduced(false));
  expect(TIERS).toContain(await page.evaluate(() => window.__snake!.tier()));

  await page.evaluate(() => window.__snake!.pinTier("low"));
  expect(await page.evaluate(() => window.__snake!.tier())).toBe("low");
  expect(await page.evaluate(() => window.__snake!.perfTier())).toBe("low");

  await page.evaluate(() => window.__snake!.pinTier("ultra"));
  expect(await page.evaluate(() => window.__snake!.tier())).toBe("ultra");
  expect(await page.evaluate(() => window.__snake!.perfTier())).toBe("ultra");
});

test("prefers-reduced-motion forces the reduced tier at boot", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
  expect(await page.evaluate(() => window.__snake!.tier())).toBe("reduced");

  // The performance tier is preserved underneath; clearing the override
  // restores it.
  expect(["low", "high", "ultra"]).toContain(
    await page.evaluate(() => window.__snake!.perfTier())
  );
  await page.evaluate(() => window.__snake!.setReduced(false));
  expect(["low", "high", "ultra"]).toContain(
    await page.evaluate(() => window.__snake!.tier())
  );
});
