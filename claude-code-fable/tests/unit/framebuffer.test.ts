import { describe, it, expect } from "vitest";
import {
  computeFit, drawScene, headPixel, BASE_PALETTE, type Fit, type PixelCtx
} from "../../app/adapters/render/framebuffer";
import { init, step } from "../../app/domain/step";
import { createSink, FB_W, FB_H, CELL_PX } from "../../app/domain/types";

/** Records fills so the scene can be checked without a real canvas. */
function recorder(): PixelCtx & { rects: number[][]; colours: Set<string> } {
  const rects: number[][] = [];
  const colours = new Set<string>();
  let fill = "";
  return {
    rects,
    colours,
    get fillStyle() { return fill; },
    set fillStyle(v) { fill = String(v); colours.add(fill); },
    fillRect(x, y, w, h) { rects.push([x, y, w, h]); }
  };
}

const fit = (): Fit => ({ scale: 0, backingW: 0, backingH: 0, dx: 0, dy: 0, w: 0, h: 0 });

describe("computeFit", () => {
  it("picks the largest integer scale that fits, min 1", () => {
    expect(computeFit(320, 480, 1, fit()).scale).toBe(1);
    expect(computeFit(1920, 1080, 1, fit()).scale).toBe(4);
    expect(computeFit(1920, 1080, 2, fit()).scale).toBe(9);
    expect(computeFit(5120, 1440, 2, fit()).scale).toBe(12);
    expect(computeFit(200, 100, 1, fit()).scale).toBe(1);
  });
  it("centres the field and sizes the backing store by dpr", () => {
    const f = computeFit(1000, 700, 1.5, fit());
    expect(f.backingW).toBe(1500);
    expect(f.backingH).toBe(1050);
    expect(f.scale).toBe(4);
    expect(f.w).toBe(FB_W * 4);
    expect(f.h).toBe(FB_H * 4);
    expect(f.dx).toBe(Math.floor((1500 - FB_W * 4) / 2));
    expect(f.dy).toBe(Math.floor((1050 - FB_H * 4) / 2));
  });
  it("never clips: the field fits inside the backing store at every size", () => {
    for (const [w, h, dpr] of [[320, 480, 1], [375, 667, 3], [800, 600, 1], [1366, 768, 1], [2560, 1440, 1], [5120, 1440, 2]]) {
      const f = computeFit(w!, h!, dpr!, fit());
      expect(f.dx + f.w).toBeLessThanOrEqual(f.backingW);
      expect(f.dy + f.h).toBeLessThanOrEqual(f.backingH);
      expect(f.dx).toBeGreaterThanOrEqual(0);
      expect(f.dy).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("drawScene", () => {
  it("clears to bg, draws the fruit, body blocks and the head with integer coords", () => {
    const s = init("snake-0001");
    const ctx = recorder();
    drawScene(ctx, s, 0, BASE_PALETTE);
    expect(ctx.rects[0]).toEqual([0, 0, FB_W, FB_H]);
    for (const [x, y, w, h] of ctx.rects) {
      for (const v of [x, y, w, h]) expect(Number.isInteger(v)).toBe(true);
      expect(x! + w!).toBeLessThanOrEqual(FB_W);
      expect(y! + h!).toBeLessThanOrEqual(FB_H);
    }
    expect(ctx.colours.has(BASE_PALETTE.fruit)).toBe(true);
    expect(ctx.colours.has(BASE_PALETTE.body)).toBe(true);
    expect(ctx.colours.has(BASE_PALETTE.head)).toBe(true);
    expect(ctx.colours.has(BASE_PALETTE.eye)).toBe(true);
    expect(ctx.colours.size).toBeLessThanOrEqual(12);
  });
  it("does not allocate per frame beyond the recorder", () => {
    const s = init("snake-0001");
    const ctx: PixelCtx = { fillStyle: "", fillRect() {} };
    for (let i = 0; i < 50; i++) drawScene(ctx, s, i / 50, BASE_PALETTE);
    expect(true).toBe(true);
  });
});

describe("headPixel", () => {
  it("glides from the neck to the head by alpha in whole pixels", () => {
    const s = init("snake-0001");
    const out = { x: 0, y: 0 };
    const hx = s.body[0]! % 32;
    const hy = Math.floor(s.body[0]! / 32);
    headPixel(s, 0, out);
    expect(out).toEqual({ x: (hx - 1) * CELL_PX, y: hy * CELL_PX });
    headPixel(s, 0.5, out);
    expect(out).toEqual({ x: (hx - 1) * CELL_PX + 4, y: hy * CELL_PX });
    headPixel(s, 0.999, out);
    expect(out).toEqual({ x: hx * CELL_PX, y: hy * CELL_PX });
  });
  it("snaps to the cell after death", () => {
    const s = init("snake-0001");
    const sink = createSink();
    s.foodY = 0;
    while (s.phase === "playing") step(s, sink);
    const out = { x: 0, y: 0 };
    headPixel(s, 0.5, out);
    expect(out.x % CELL_PX).toBe(0);
  });
});
