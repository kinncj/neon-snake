import { expect, test } from "@playwright/test";
import "./snake-debug";

const BG: [number, number, number] = [5, 6, 15]; // #05060f

async function waitReady(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => window.__snake !== undefined);
}

/**
 * Wait until the 2D compositor is authoritative: the corner letterbox pixel
 * reads the exact bg colour. The GL composite darkens the corners (vignette),
 * so an exact-bg read can only come from the 2D path.
 */
async function wait2D(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const p = window.__snake!.sample(0, 0);
      return p[0] === 5 && p[1] === 6 && p[2] === 15 && p[3] === 255;
    },
    null,
    { timeout: 2000 }
  );
}

const CONFIGS = [
  { cssW: 320, cssH: 480, dpr: 1 },
  { cssW: 390, cssH: 844, dpr: 3 },
  { cssW: 768, cssH: 1024, dpr: 2 },
  { cssW: 1920, cssH: 1080, dpr: 1 },
  { cssW: 3440, cssH: 1440, dpr: 1 },
  { cssW: 5120, cssH: 1440, dpr: 2 }
];

for (const cfg of CONFIGS) {
  test.describe(`${cfg.cssW}x${cfg.cssH}@${cfg.dpr}`, () => {
    test.use({
      viewport: { width: cfg.cssW, height: cfg.cssH },
      deviceScaleFactor: cfg.dpr
    });

    test("full field visible, 1:1 cells, no clipping", async ({ page }) => {
      await page.goto("/");
      await waitReady(page);
      // These pixel assertions verify the step-10 2D compositor, so pin the
      // tier to low (the GL effects layer owns high/ultra frames).
      await page.evaluate(() => window.__snake!.tier.pinPerf("low"));
      await wait2D(page);

      const devW = Math.round(cfg.cssW * cfg.dpr);
      const devH = Math.round(cfg.cssH * cfg.dpr);

      const info = await page.evaluate(() => window.__snake!.composite());

      // Backing store tracks cssPx * devicePixelRatio
      expect(info.deviceW).toBe(devW);
      expect(info.deviceH).toBe(devH);

      // Integer scale, the exact spec formula
      expect(Number.isInteger(info.scale)).toBe(true);
      expect(info.scale).toBe(Math.max(1, Math.floor(Math.min(devW / 256, devH / 240))));

      // Full field visible, no clipping: the composite fits inside the canvas
      expect(info.drawW).toBe(256 * info.scale);
      expect(info.drawH).toBe(240 * info.scale);
      expect(info.drawW).toBeLessThanOrEqual(info.deviceW);
      expect(info.drawH).toBeLessThanOrEqual(info.deviceH);
      expect(info.offX).toBeGreaterThanOrEqual(0);
      expect(info.offY).toBeGreaterThanOrEqual(0);
      expect(info.offX + info.drawW).toBeLessThanOrEqual(info.deviceW);
      expect(info.offY + info.drawH).toBeLessThanOrEqual(info.deviceH);

      // 1:1 cell aspect: a single uniform scale on both axes
      expect(info.drawW / 256).toBe(info.drawH / 240);

      // Letterbox band is exactly the bg colour. Pick a band that is non-zero.
      const sample = async (x: number, y: number) =>
        page.evaluate(
          ([px, py]) => window.__snake!.sample(px, py) as [number, number, number, number],
          [x, y] as [number, number]
        );
      if (info.offX > 0) {
        const lx = await sample(Math.floor(info.offX / 2), Math.floor(devH / 2));
        expect(lx.slice(0, 3)).toEqual(BG);
      }
      if (info.offY > 0) {
        const ly = await sample(Math.floor(devW / 2), Math.floor(info.offY / 2));
        expect(ly.slice(0, 3)).toEqual(BG);
      }

      // The field is actually drawn: a centre row has non-bg content (grid lines)
      const nonBg = await page.evaluate(({ offX, offY, drawW, drawH }) => {
        const cv = document.getElementById("game") as HTMLCanvasElement;
        const ctx = cv.getContext("2d")!;
        const y = offY + Math.floor(drawH / 2);
        const d = ctx.getImageData(offX, y, drawW, 1).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] !== 5 || d[i + 1] !== 6 || d[i + 2] !== 15) n++;
        }
        return n;
      }, info);
      expect(nonBg).toBeGreaterThan(0);
    });
  });
}

test("mid-session resize keeps the game state unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await waitReady(page);

  const before = await page.evaluate(() => {
    window.__snake!.freeze();
    return window.__snake!.fingerprint();
  });
  const scaleBefore = await page.evaluate(() => window.__snake!.composite().scale);
  expect(scaleBefore).toBe(4); // 1920x1080@1 -> floor(min(7.5, 4.5)) = 4

  await page.setViewportSize({ width: 800, height: 1200 });
  await page.waitForTimeout(120);

  const after = await page.evaluate(() => window.__snake!.fingerprint());
  const scaleAfter = await page.evaluate(() => window.__snake!.composite().scale);
  expect(scaleAfter).toBe(3); // 800x1200@1 -> floor(min(3.125, 5)) = 3

  // The resize must not reset or mutate the simulation
  expect(after).toEqual(before);
});
