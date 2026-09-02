import { expect, test, type Page } from "@playwright/test";

/**
 * Viewport behaviour gate (step 10):
 *   - across 320x480@1 .. 5120x1440@2 the full 256x240 field is visible at
 *     integer scale, 1:1 cells (8*scale device px per cell), no clipping;
 *   - a mid-session resize keeps the simulation state unchanged (resize only
 *     re-renders; it never steps the domain).
 *
 * Ground truth is the 2D composite surface (#game canvas), which is always
 * rendered and cross-browser readable.
 */

// Exact colours from the base scene (app/adapters/render/framebuffer.ts).
const BG = [18, 18, 28]; // #12121c
const GRID = [36, 40, 59]; // #24283b
const BODY = [0, 229, 255]; // #00e5ff
const HEAD = [192, 202, 245]; // #c0caf5

interface Probe {
  hx: number;
  hy: number;
  sx: number;
  sy: number;
  hash: string;
  phase: string;
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const api = window.__snake;
    if (!api) throw new Error("no __snake debug api");
    api.pause();
    const h = api.head();
    const s1 = api.body1(); // the cell behind the head
    return {
      hx: h.x,
      hy: h.y,
      sx: s1.x,
      sy: s1.y,
      hash: api.hash(),
      phase: api.phase()
    };
  });
}

async function px(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate((args) => {
    const sx = args[0]!;
    const sy = args[1]!;
    const c = document.getElementById("game");
    if (!(c instanceof HTMLCanvasElement)) throw new Error("no #game canvas");
    const g = c.getContext("2d");
    if (g === null) throw new Error("no 2d context");
    const d = g.getImageData(sx, sy, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!];
  }, [x, y]);
}

const CASES = [
  { width: 320, height: 480, dpr: 1 },
  { width: 1280, height: 720, dpr: 1 },
  { width: 1920, height: 1080, dpr: 2 },
  { width: 5120, height: 1440, dpr: 2 }
];

for (const c of CASES) {
  test(`viewport ${c.width}x${c.height}@${c.dpr}: full field, 1:1 cells, no clipping`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: c.dpr
    });
    const page = await context.newPage();
    await page.goto("/");

    const p = await probe(page);
    // let a couple of paused frames settle (head drawn at its exact cell)
    await page.waitForTimeout(120);

    const W = c.width * c.dpr;
    const H = c.height * c.dpr;
    const size = await page.evaluate(() => {
      const el = document.getElementById("game");
      if (!(el instanceof HTMLCanvasElement)) throw new Error("no canvas");
      return { w: el.width, h: el.height, dpr: window.devicePixelRatio };
    });
    expect(size.w).toBe(W);
    expect(size.h).toBe(H);
    expect(size.dpr).toBe(c.dpr);

    // integer layout (mirrors the renderer formula)
    const scale = Math.max(1, Math.floor(Math.min(W / 256, H / 240)));
    const fw = 256 * scale;
    const fh = 240 * scale;
    const ox = Math.floor((W - fw) / 2);
    const oy = Math.floor((H - fh) / 2);

    // full field, no clipping: the field rectangle lies inside the canvas
    expect(ox).toBeGreaterThanOrEqual(0);
    expect(oy).toBeGreaterThanOrEqual(0);
    expect(ox + fw).toBeLessThanOrEqual(W);
    expect(oy + fh).toBeLessThanOrEqual(H);

    // field border pixel (offscreen corner) renders the grid colour
    expect(await px(page, ox, oy)).toEqual(GRID);
    // head pixel (centre of the head cell) renders the head colour
    const hpx = ox + (p.hx * 8 + 4) * scale;
    const hpy = oy + (p.hy * 8 + 4) * scale;
    expect(await px(page, hpx, hpy)).toEqual(HEAD);
    // 1:1 cells: the cell behind the head fills exactly its 8*scale block;
    // the device pixel just past its right edge belongs to the head cell.
    const cellCenterY = oy + (p.sy * 8 + 4) * scale;
    expect(await px(page, ox + (p.sx * 8 + 4) * scale, cellCenterY)).toEqual(BODY);
    const boundary = ox + (p.sx + 1) * 8 * scale;
    expect(await px(page, boundary - 1, cellCenterY)).toEqual(BODY);
    expect(await px(page, boundary, cellCenterY)).toEqual(HEAD);
    // letterbox: outside the field is background (when a margin exists)
    if (ox >= 4) {
      expect(await px(page, ox - 4, Math.floor(H / 2))).toEqual(BG);
    }
    if (oy >= 4) {
      expect(await px(page, Math.floor(W / 2), oy - 4)).toEqual(BG);
    }

    // mid-session resize: the simulation state is unchanged
    const h1 = p.hash;
    await page.setViewportSize({ width: 640, height: 480 });
    await page.waitForTimeout(120);
    const h2 = await page.evaluate(() => window.__snake!.hash());
    expect(h2).toBe(h1);
    const size2 = await page.evaluate(() => {
      const el = document.getElementById("game");
      if (!(el instanceof HTMLCanvasElement)) throw new Error("no canvas");
      return { w: el.width, h: el.height };
    });
    expect(size2.w).toBe(640 * c.dpr);
    expect(size2.h).toBe(480 * c.dpr);

    await context.close();
  });
}
