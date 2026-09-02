import { describe, expect, it } from "vitest";
import { computeLayout } from "../../app/adapters/render/framebuffer";
import { FIELD_H, FIELD_W } from "../../app/domain/types";

/**
 * The integer composite layout (step 10): backing store = cssPx * dpr,
 * integer scale = max(1, floor(min(W/256, H/240))), centred field.
 */
describe("computeLayout", () => {
  it("is 1:1 on a small viewport (320x480 @1)", () => {
    const l = computeLayout(320, 480, 1);
    expect(l.W).toBe(320);
    expect(l.H).toBe(480);
    expect(l.scale).toBe(1);
    expect(l.fw).toBe(256);
    expect(l.fh).toBe(240);
    expect(l.ox).toBe(32);
    expect(l.oy).toBe(120);
  });

  it("pillarboxes a wide 1080p viewport @2", () => {
    // 1920x1080 css @ dpr2 -> 3840x2160 backing; height-limited scale.
    const l = computeLayout(1920, 1080, 2);
    expect(l.W).toBe(3840);
    expect(l.H).toBe(2160);
    expect(l.scale).toBe(Math.floor(Math.min(3840 / 256, 2160 / 240)));
    expect(l.scale).toBe(9);
    expect(l.fh).toBe(240 * 9);
    expect(l.oy).toBe(0);
    expect(l.ox).toBe((3840 - 256 * 9) / 2);
  });

  it("letterboxes a tall viewport", () => {
    const l = computeLayout(256, 800, 1);
    expect(l.scale).toBe(1);
    expect(l.ox).toBe(0);
    expect(l.oy).toBe((800 - 240) / 2);
  });

  it("never scales below 1 (tiny viewport)", () => {
    const l = computeLayout(50, 50, 1);
    expect(l.scale).toBe(1);
    // the field is larger than the viewport: offsets may go negative, but
    // the scale itself stays integer 1 (the field is clipped by the canvas,
    // never sub-sampled).
    expect(Number.isInteger(l.ox)).toBe(true);
    expect(Number.isInteger(l.oy)).toBe(true);
  });

  it("keeps the field centred and integral for a dpr-2 5120x1440 viewport", () => {
    const l = computeLayout(5120, 1440, 2);
    expect(l.W).toBe(10240);
    expect(l.H).toBe(2880);
    expect(l.scale).toBe(12);
    expect(l.fw).toBe(256 * 12);
    expect(l.fh).toBe(240 * 12);
    expect(l.ox + l.fw).toBeLessThanOrEqual(l.W);
    expect(l.oy + l.fh).toBeLessThanOrEqual(l.H);
    expect(l.ox).toBe((10240 - 256 * 12) / 2);
  });

  it("always fits the field inside the backing store at realistic sizes", () => {
    const sizes: Array<[number, number, number]> = [
      [320, 480, 1],
      [640, 480, 1],
      [1024, 768, 1],
      [1280, 720, 1],
      [1920, 1080, 1],
      [1920, 1080, 2],
      [2560, 1440, 2],
      [5120, 1440, 2]
    ];
    for (const [w, h, dpr] of sizes) {
      const l = computeLayout(w, h, dpr);
      expect(l.scale).toBeGreaterThanOrEqual(1);
      expect(l.fw).toBe(FIELD_W * l.scale);
      expect(l.fh).toBe(FIELD_H * l.scale);
      expect(l.ox).toBeGreaterThanOrEqual(0);
      expect(l.oy).toBeGreaterThanOrEqual(0);
      expect(l.ox + l.fw).toBeLessThanOrEqual(l.W);
      expect(l.oy + l.fh).toBeLessThanOrEqual(l.H);
    }
  });
});
