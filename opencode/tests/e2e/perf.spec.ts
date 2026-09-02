import { expect, test } from "@playwright/test";
import type { CDPSession } from "@playwright/test";

// CDP is a Chromium-only protocol; the perf budgets are measured there.
test.skip(({ browserName }) => browserName !== "chromium", "CDP perf tooling is Chromium-only");

async function ready(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
}

test("p95 frame work stays under 16.7ms at low tier with 4x CPU throttle", async ({
  page,
  context
}) => {
  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await ready(page);
  await page.evaluate(() => {
    window.__snake!.setReduced(false);
    window.__snake!.pinTier("low");
  });
  // let the 240-sample ring fill (~240 frames)
  await page.waitForFunction(
    () => window.__snake!.perf().n >= 220,
    null,
    { timeout: 30000 }
  );
  const p = await page.evaluate(() => window.__snake!.perf());
  expect(p.n).toBeGreaterThanOrEqual(220);
  // the budget: p95 per-frame work < one 60Hz frame
  expect(p.p95).toBeLessThan(16.7);
  expect(p.max).toBeLessThan(50);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});

test("steady-state heap growth over 600 frames is negligible at low tier", async ({
  page,
  context
}) => {
  const cdp: CDPSession = await context.newCDPSession(page);
  await ready(page);
  await page.evaluate(() => {
    window.__snake!.setReduced(false);
    window.__snake!.pinTier("low");
  });
  // no user gesture: the synth stays locked, so audio nodes add no garbage
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Runtime.getHeapUsage");
  await page.waitForTimeout(10000); // ~600 frames at 60fps
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Runtime.getHeapUsage");
  const delta = after.usedSize - before.usedSize;
  // ~600 frames of steady state: allow < 256KB total (≈420B/frame), which
  // covers V8 noise but would catch any per-frame object growth
  expect(delta).toBeLessThan(256 * 1024);
  // and it must not be a large negative regression signal either
  expect(delta).toBeGreaterThan(-256 * 1024);
});

test("time to first painted frame is under 1.5s (warm server)", async ({ page }) => {
  const t0 = Date.now();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__snake !== undefined && window.__snake!.sample(0, 0)[0] !== 0,
    null,
    { timeout: 5000 }
  );
  const tti = Date.now() - t0;
  expect(tti).toBeLessThan(1500);
});
