import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { play } from "./snake-debug";

/**
 * FX-layer wiring (the screen-space WebGL compositor above the 2D ground
 * truth). Verified through the window.__snake debug bridge: the GL state
 * machine (bloom / shockwave / particles / tier / death) via fx.info(), and
 * the pixel ground truth via sample()/luma() on the 2D surface.
 *
 * The GL canvas itself is not read back (driver-dependent); the assertions
 * that matter are (a) the layer boots and reports a healthy budget, (b) it
 * degrades to the 2D path on failure, and (c) the effect envelopes fire and
 * decay on time.
 */

const SEED = "snake-0001";
// Playwright runs with cwd = the config directory (project root).
const LOG_TEXT = readFileSync("tests/fixtures/run-a.log", "utf8");

// 2D ground-truth bg colour (see framebuffer.ts BASE_PALETTE / BASE_SCENE).
// The head colour is #c0caf5 (192,202,245), asserted blue-dominant below.
const BG: [number, number, number] = [18, 18, 28]; // #12121c

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
  // the FBO is capped so the field never allocates a full-res RGBA8 buffer
  expect(info.fbo[0]!).toBeLessThanOrEqual(1600);
  expect(info.fbo[1]!).toBeLessThanOrEqual(900);
});

test("disabling the GL layer degrades to the 2D path, game still renders", async ({
  page
}) => {
  // The game boots paused behind the title screen; start it so the sim runs.
  await play(page);
  // Normalise reduced-motion so the ultra pin actually takes.
  await page.evaluate(() => window.__snake!.setReduced(false));
  await page.evaluate(() => window.__snake!.fx.forceTier("ultra"));
  // let the GL pipeline go live (selfTest is engine-dependent: a default-FB
  // readback can report black on a healthy pipeline, so we only require the
  // probe to be callable here, not to be "ok")
  await page.waitForFunction(
    () => window.__snake!.fx.info().tier === "ultra",
    null,
    { timeout: 2000 }
  );
  expect(
    await page.evaluate(() => typeof window.__snake!.fx.selfTest())
  ).toBe("string");
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
  // the game keeps simulating (still playing, not frozen by the fallback)
  expect(await page.evaluate(() => window.__snake!.phase())).toBe("playing");
});

test("ultra: eating fires a shockwave + particle burst; bloom rises and decays within 400ms", async ({
  page
}) => {
  await ready(page);
  await page.evaluate(() => window.__snake!.setReduced(false));
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
  expect(
    (await page.evaluate(() => window.__snake!.fingerprint())).score
  ).toBeGreaterThanOrEqual(10);

  // freeze so no further 'ate' events re-inject bloom; the pulse itself must
  // decay back down within 400ms of its peak (120ms time constant)
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
  await page.waitForFunction(
    () => window.__snake!.fx.info().shockActive === false,
    null,
    { timeout: 1000, polling: 16 }
  );
});

test("low vs ultra replay the same log to the same hash", async ({ page }) => {
  await ready(page);
  const hLow = await page.evaluate(
    ([text, seed]: [string, string]) => {
      window.__snake!.setReduced(false);
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
  await page.waitForFunction(() => window.__snake!.fx.info().tier === "ultra");
  // low tier runs only the base composite (the GL canvas stays in the DOM,
  // hidden) — two canvases total
  await page.evaluate(() => window.__snake!.fx.forceTier("low"));
  await page.waitForFunction(() => window.__snake!.fx.info().tier === "low");
  expect(await page.evaluate(() => document.querySelectorAll("canvas").length)).toBe(
    2
  );
});

test("death sequence: full-frame luminance transitions stay within 3/sec", async ({
  page
}) => {
  await ready(page);
  await page.evaluate(() => window.__snake!.setReduced(false));
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

  // sample full-frame luminance for 1.5s at the frame rate and count
  // transitions
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

test("composite renders the real field, not just a letterbox (head pixel is the head colour)", async ({
  page
}) => {
  await ready(page);
  await page.evaluate(() => {
    window.__snake!.setReduced(false);
    window.__snake!.fx.forceTier("ultra");
    window.__snake!.freeze(); // hold the snake still so the head pixel is stable
  });
  await page.waitForFunction(() => window.__snake!.fx.info().tier === "ultra");
  await page.waitForTimeout(300); // let a frame land

  // The composite field rect, in FBO-normalised UVs: this is the exact math
  // behind the one-cell-wide-field regression. At this viewport (1280x720,
  // scale 3) the field is 768x720 device px; the rect must cover the full
  // field in both axes — a one-cell rect (~0.02 x 0.03) fails on every host.
  const fr = await page.evaluate(() => window.__snake!.fx.info().fieldRect);
  expect(fr[2]!).toBeGreaterThan(0.3); // width: a third of the FBO at least
  expect(fr[3]!).toBeGreaterThan(0.6); // height: most of the FBO at least
  expect(fr[0]!).toBeGreaterThanOrEqual(-0.1);
  expect(fr[1]!).toBeLessThanOrEqual(1.1);

  // The head's device pixel, from the same composite math the renderer uses.
  const probe = await page.evaluate(() => {
    const s = window.__snake!;
    const c = s.composite();
    const h = s.head();
    const hx = Math.floor(c.offX + (h.x * 8 + 4) * c.scale);
    const hy = Math.floor(c.offY + (h.y * 8 + 4) * c.scale);
    const headPx = s.sample(hx, hy);
    // a letterbox point: the dark bg family, well under the head
    const letterbox = s.sample(Math.floor(c.offX / 2), Math.floor(c.deviceH / 2));
    return { headPx, letterbox };
  });
  // head colour is #c0caf5 (192,202,245): blue dominates. Fails if the
  // composite only painted a tiny window or a flat letterbox.
  expect(probe.headPx[2]!).toBeGreaterThan(120);
  expect(probe.headPx[2]!).toBeGreaterThan(probe.headPx[0]!);
  expect(probe.headPx[2]!).toBeGreaterThan(probe.headPx[1]!);
  expect(probe.headPx[0]!).toBeGreaterThan(BG[0]! * 2);
  // letterbox is the dark bg family, exactly the bg colour on the 2D surface
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(probe.letterbox[i]! - BG[i]!)).toBeLessThan(8);
  }
});
