/**
 * Framebuffer geometry: integer-scaled letterbox composite math and the
 * smooth-walk interpolation. Pure — no canvas needed.
 */
import { describe, it, expect } from "vitest";
import {
  computeComposite,
  fillComposite,
  interpCell,
  FB_W,
  FB_H,
  type MutableComposite
} from "../../app/adapters/render/framebuffer";
import { CELL_PX } from "../../app/domain/types";

const info: MutableComposite = {
  deviceW: 0,
  deviceH: 0,
  scale: 1,
  offX: 0,
  offY: 0,
  drawW: 0,
  drawH: 0
};

describe("fillComposite", () => {
  it("scales to the largest integer that fits both axes", () => {
    // 1280x720: field 256x240 -> scale 3 (768x720), centred
    fillComposite(1280, 720, info);
    expect(info.scale).toBe(3);
    expect(info.drawW).toBe(FB_W * 3);
    expect(info.drawH).toBe(FB_H * 3);
    expect(info.offX).toBe((1280 - FB_W * 3) / 2);
    expect(info.offY).toBe((720 - FB_H * 3) / 2);
  });

  it("never scales below 1 and centring stays integral", () => {
    // tiny device: scale clamps to 1, field larger than screen is fine
    fillComposite(100, 100, info);
    expect(info.scale).toBe(1);
    // the centre of the field maps to the centre of the screen
    const cx = info.offX + info.drawW / 2;
    const cy = info.offY + info.drawH / 2;
    expect(cx).toBeCloseTo(info.deviceW / 2, 5);
    expect(cy).toBeCloseTo(info.deviceH / 2, 5);
  });
});

describe("computeComposite", () => {
  it("matches fillComposite (same pure math, different entry)", () => {
    const a: MutableComposite = {
      deviceW: 0,
      deviceH: 0,
      scale: 1,
      offX: 0,
      offY: 0,
      drawW: 0,
      drawH: 0
    };
    fillComposite(900, 600, a);
    const b = computeComposite(900, 600);
    expect(b.scale).toBe(a.scale);
    expect(b.offX).toBe(a.offX);
    expect(b.offY).toBe(a.offY);
    expect(b.drawW).toBe(a.drawW);
    expect(b.drawH).toBe(a.drawH);
  });
});

describe("interpCell (smooth walk)", () => {
  it("alpha 0 -> from cell, alpha 1 -> to cell", () => {
    const a = interpCell(3, 4, 4, 4, 0);
    expect(a).toEqual({ x: 3 * CELL_PX, y: 4 * CELL_PX });
    const b = interpCell(3, 4, 4, 4, 1);
    expect(b).toEqual({ x: 4 * CELL_PX, y: 4 * CELL_PX });
  });

  it("stays on the integer grid for any alpha", () => {
    for (const t of [0, 0.1, 0.37, 0.5, 0.63, 0.9, 1]) {
      const p = interpCell(0, 0, 1, 0, t);
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(0 * CELL_PX);
      expect(p.x).toBeLessThanOrEqual(1 * CELL_PX);
    }
  });

  it("handles a left/down move (negative delta)", () => {
    const p = interpCell(5, 2, 4, 3, 1);
    expect(p).toEqual({ x: 4 * CELL_PX, y: 3 * CELL_PX });
  });

  it("a stationary segment (from == to) never moves", () => {
    for (const t of [0, 0.5, 1]) {
      const p = interpCell(7, 7, 7, 7, t);
      expect(p).toEqual({ x: 7 * CELL_PX, y: 7 * CELL_PX });
    }
  });
});
