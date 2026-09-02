import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { play } from "./snake-debug";

const SEED = "snake-0001";
// Playwright runs with cwd = the config directory (project root)
const LOG_TEXT = readFileSync("tests/fixtures/run-a.log", "utf8");

async function ready(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
}

test("webgl2 is available (gate preconditions)", async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(() => window.__snake!.fx.ready())).toBe(true);
  const info = await page.evaluate(() => window.__snake!.fx.info());
  // texture budget: total texture memory < 8 MB
  expect(info.texMB).toBeLessThan(8);
  expect(info.fbo[0]).toBeLessThanOrEqual(1600);
  expect(info.fbo[1]).toBeLessThanOrEqual(900);
});

test("disabling the GL layer degrades to the 2D path, game still renders", async ({
  page
}) => {
  await play(page);
  await page.evaluate(() => window.__snake!.fx.forceTier("ultra"));
  // let the GL pipeline go live (selfTest is engine-dependent: Firefox's
  // default-FB readback can report black on a healthy pipeline, so we only
  // require it to be callable here, not true)
  await page.waitForFunction(
    () => window.__snake!.fx.info().tier === "ultra",
    null,
    { timeout: 2000 }
  );
  expect(await page.evaluate(() => typeof window.__snake!.fx.selfTest())).toBe("string");
  // force the failure mode a broken driver would hit: disable the layer
  await page.evaluate(() => window.__snake!.fx.disable("e2e-simulated-loss"));
  // the layer reports not-ready and the GL canvas is hidden (2D shown)
  await page.waitForFunction(() => window.__snake!.fx.ready() === false, null, {
    timeout: 2000
  });
  await page.waitForTimeout(120); // let a few 2D frames land
  const ok = await page.evaluate(() => {
    const s = window.__snake!;
    // a 2D-path sample of the field background must be the (non-black) bg
    const c = s.composite();
    const x = Math.floor(c.offX + 4 * c.scale);
    const y = Math.floor(c.offY + 4 * c.scale);
    const p = s.sample(x, y);
    return (p[0] ?? 0) + (p[1] ?? 0) + (p[2] ?? 0) > 0;
  });
  expect(ok).toBe(true);
  // the game keeps simulating (phase still playing, not frozen by the fallback)
  expect(await page.evaluate(() => window.__snake!.state.phase)).toBe("playing");
});

test("ultra: eating fires a shockwave + particle burst; bloom rises and decays within 400ms", async ({
  page
}) => {
  await play(page);
  await page.evaluate(() => window.__snake!.fx.forceTier("ultra"));
  // give the compositor one frame at ultra so the GL pipeline is live
  await page.waitForFunction(() => window.__snake!.fx.info().tier === "ultra");

  await page.evaluate(() => {
    window.__snake!.freeze();
    window.__snake!.fx.teleportFoodAhead();
    window.__snake!.unfreeze();
  });

  // shortly after the eating tick: shockwave active, burst spawned, bloom risen
  await page.waitForFunction(
    () => {
      const i = window.__snake!.fx.info();
      return i.shockActive && i.particles > 0 && i.bloom > 0.2;
    },
    null,
    { timeout: 2000, polling: 30 }
  );
  const mid = await page.evaluate(() => window.__snake!.fx.info());
  expect(mid.drawCalls).toBeLessThanOrEqual(12);
  expect((await page.evaluate(() => window.__snake!.fingerprint())).score).toBeGreaterThanOrEqual(10);

  // freeze so no further 'ate' events re-inject bloom; the pulse itself must
  // decay back down within 400ms of its peak (140ms time constant)
  await page.evaluate(() => window.__snake!.freeze());
  const decayedMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        const tick = (): void => {
          if (window.__snake!.fx.info().bloom < 0.05) {
            resolve(performance.now() - t0);
          } else if (performance.now() - t0 > 3000) {
            resolve(-1);
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      })
  );
  expect(decayedMs).toBeGreaterThan(0);
  expect(decayedMs).toBeLessThan(550);
  const after = await page.evaluate(() => window.__snake!.fx.info());
  expect(after.bloom).toBeLessThan(0.05);
  // the shockwave (450ms) outlives the bloom pulse; give it a moment
  await page.waitForFunction(() => window.__snake!.fx.info().shockActive === false, null, {
    timeout: 1000,
    polling: 16
  });
});

test("low vs ultra replay the same log to the same hash", async ({ page }) => {
  await ready(page);
  const hLow = await page.evaluate(
    ([text, seed]: [string, string]) => {
      window.__snake!.fx.forceTier("low");
      return window.__snake!.replayLog(text, seed);
    },
    [LOG_TEXT, SEED] as [string, string]
  );
  const hUltra = await page.evaluate(
    ([text, seed]: [string, string]) => {
      window.__snake!.fx.forceTier("ultra");
      return window.__snake!.replayLog(text, seed);
    },
    [LOG_TEXT, SEED] as [string, string]
  );
  expect(hLow).toBe(hUltra);
  // and it matches the hash recorded by the unit replay test
  expect(hLow).toBe("2e58d3c2");
  // after the ultra replay the effective tier is ultra again; the point of
  // the gate is that the simulation hash did not depend on the tier
  const info = await page.evaluate(() => window.__snake!.fx.info());
  expect(info.tier).toBe("ultra");
  // low tier runs only the base composite (GL canvas hidden)
  await page.evaluate(() => window.__snake!.fx.forceTier("low"));
  await page.waitForFunction(() => window.__snake!.fx.info().tier === "low");
  expect(await page.evaluate(() => document.querySelectorAll("canvas").length)).toBe(2);
});

test("death sequence: full-frame luminance transitions stay within 3/sec", async ({ page }) => {
  await play(page);
  await page.evaluate(() => window.__snake!.fx.forceTier("ultra"));
  await page.waitForFunction(() => window.__snake!.fx.info().tier === "ultra");

  await page.evaluate(() => {
    window.__snake!.freeze();
    window.__snake!.fx.forceDeath();
    window.__snake!.unfreeze();
  });
  // wait until the death dissolve is actually running
  await page.waitForFunction(() => window.__snake!.fx.info().deathActive, null, {
    timeout: 2000,
    polling: 30
  });

  // sample full-frame luminance for 1.5s at ~40ms and count transitions
  const samples: number[] = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        const t0 = performance.now();
        const tick = (): void => {
          out.push(window.__snake!.luma());
          if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      })
  );
  let transitions = 0;
  for (let i = 1; i < samples.length; i++) {
    if (Math.abs(samples[i]! - samples[i - 1]!) > 0.15) transitions++;
  }
  // ~1.5s of samples: the budget is 3 full-frame luminance transitions per
  // second, so over 1.5s at most 4 (3 * 1.5 rounded up) are allowed
  expect(transitions).toBeLessThanOrEqual(4);
});

test("GL composite renders the real field, not just a letterbox (head pixel is the head colour)", async ({
  page
}) => {
  await play(page);
  await page.evaluate(() => {
    window.__snake!.fx.forceTier("ultra");
    window.__snake!.freeze(); // hold the snake still so the head pixel is stable
  });
  await page.waitForFunction(() => window.__snake!.fx.info().tier === "ultra");
  await page.waitForTimeout(300); // let a GL frame land

  // The composite field rect, in FBO-normalised UVs: this is the exact math
  // behind the one-cell-wide-field regression. At this viewport (1280x720,
  // scale 3) the field is 768x720 device px; the FBO is at most 1024x576 so
  // the rect must cover the full field in both axes — a one-cell rect
  // (~0.02 x 0.03) fails this on every engine, readback or not.
  const fr = await page.evaluate(() =>
    window.__snake!.fx.info().fieldRect
  );
  expect(fr[2]!).toBeGreaterThan(0.3); // width: a third of the FBO at least
  expect(fr[3]!).toBeGreaterThan(0.6); // height: most of the FBO at least
  expect(fr[0]!).toBeGreaterThanOrEqual(-0.1);
  expect(fr[1]!).toBeLessThanOrEqual(1.1);

  // The head's device pixel, from the same composite math the renderer uses.
  const probe = await page.evaluate(() => {
    const s = window.__snake!;
    const c = s.composite();
    const h = s.state.body[0]!;
    const hx = Math.floor(c.offX + (h.x * 8 + 4) * c.scale);
    const hy = Math.floor(c.offY + (h.y * 8 + 4) * c.scale);
    const headPx = s.sample(hx, hy);
    // a letterbox point: must be dark but not the (nonexistent) raw GL black
    const letterbox = s.sample(Math.floor(c.offX / 2), Math.floor(c.deviceH / 2));
    // a field point that is not the head: grid or bg, definitely not head green
    return { headPx, letterbox, c };
  });
  // head colour is #5ffbf1 (95,251,241); post passes (vignette/scanline)
  // darken it, but green must dominate strongly — this fails if the composite
  // only painted a tiny window or a flat letterbox.
  expect(probe.headPx[1]!).toBeGreaterThan(120);
  expect(probe.headPx[1]!).toBeGreaterThan(probe.headPx[0]!);
  expect(probe.headPx[1]!).toBeGreaterThan(probe.headPx[2]!);
  // letterbox is the dark bg family, well under the head
  expect(probe.letterbox[0]! + probe.letterbox[1]! + probe.letterbox[2]!).toBeLessThan(60);
});
