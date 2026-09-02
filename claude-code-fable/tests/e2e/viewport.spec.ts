import { test, expect, type Browser } from "@playwright/test";
import { ready, fit, sample, snakeState } from "./snake-debug";

const FB_W = 256;
const FB_H = 240;

/** The viewport matrix: css size @ device pixel ratio. */
const MATRIX: Array<[number, number, number]> = [
  [320, 480, 1],
  [375, 667, 2],
  [800, 600, 1],
  [1366, 768, 1],
  [1920, 1080, 1],
  [2560, 1440, 1],
  [5120, 1440, 2]
];

async function openAt(browser: Browser, w: number, h: number, dpr: number) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  await page.goto("/");
  await ready(page);
  return { ctx, page };
}

const isBg = (rgba: number[]) => rgba[0]! < 40 && rgba[1]! < 40 && rgba[2]! < 60;

for (const [w, h, dpr] of MATRIX) {
  test(`full field at ${w}x${h}@${dpr}: integer scale, 1:1 cells, no clipping`, async ({ browser }) => {
    const { ctx, page } = await openAt(browser, w, h, dpr);
    const f = await fit(page);
    // The display canvas fills the CRT glass, which is inset from the viewport by the bezel.
    const glass = await page.evaluate(() => {
      const c = document.getElementById("display")!;
      return [c.clientWidth, c.clientHeight];
    });
    expect(f.backingW).toBe(Math.round(glass[0]! * dpr));
    expect(f.backingH).toBe(Math.round(glass[1]! * dpr));
    expect(glass[0]!).toBeLessThan(w);
    expect(glass[1]!).toBeLessThan(h);
    expect(f.scale).toBe(Math.max(1, Math.floor(Math.min(f.backingW / FB_W, f.backingH / FB_H))));
    expect(f.w).toBe(FB_W * f.scale);
    expect(f.h).toBe(FB_H * f.scale);
    expect(f.dx).toBeGreaterThanOrEqual(0);
    expect(f.dy).toBeGreaterThanOrEqual(0);
    expect(f.dx + f.w).toBeLessThanOrEqual(f.backingW);
    expect(f.dy + f.h).toBeLessThanOrEqual(f.backingH);

    // The field's own background is drawn at all four corners of the field,
    // and the letterbox outside it is pure black.
    await page.waitForTimeout(80);
    const inset = 2;
    for (const [x, y] of [
      [f.dx + inset, f.dy + inset],
      [f.dx + f.w - inset - 1, f.dy + inset],
      [f.dx + inset, f.dy + f.h - inset - 1],
      [f.dx + f.w - inset - 1, f.dy + f.h - inset - 1]
    ]) {
      const c = await sample(page, x!, y!);
      expect(isBg(c)).toBe(true);
      expect(c[0]! + c[1]! + c[2]!).toBeGreaterThan(0); // field bg is not the letterbox black
    }
    if (f.dx > 0) {
      const c = await sample(page, Math.floor(f.dx / 2), Math.floor(f.backingH / 2));
      expect(c.slice(0, 3)).toEqual([0, 0, 0]);
    }
    if (f.dy > 0) {
      const c = await sample(page, Math.floor(f.backingW / 2), Math.floor(f.dy / 2));
      expect(c.slice(0, 3)).toEqual([0, 0, 0]);
    }
    await ctx.close();
  });
}

test("mid-session resize keeps the simulation state unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await ready(page);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__snake.freeze());
  const before = await page.evaluate(() => window.__snake.hash());
  const tickBefore = (await snakeState(page)).tick;
  expect(tickBefore).toBeGreaterThan(0);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__snake.hash())).toBe(before);
  expect((await snakeState(page)).tick).toBe(tickBefore);
  const f = await fit(page);
  const glassW = await page.evaluate(() => document.getElementById("display")!.clientWidth);
  expect(f.backingW).toBe(glassW);
  expect(f.scale).toBe(Math.max(1, Math.floor(Math.min(f.backingW / FB_W, f.backingH / FB_H))));
  await page.evaluate(() => window.__snake.unfreeze());
  await page.waitForTimeout(200);
  expect((await snakeState(page)).tick).toBeGreaterThan(tickBefore);
});
