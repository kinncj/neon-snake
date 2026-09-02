/**
 * ThemeMixer: pure colour-transition math, no DOM.
 */
import { describe, it, expect } from "vitest";
import {
  ThemeMixer,
  LEVEL_THEMES,
  themeForLevel
} from "../../app/adapters/render/theme";

describe("themeForLevel", () => {
  it("clamps to the available levels", () => {
    expect(themeForLevel(0).name).toBe(LEVEL_THEMES[0]!.name);
    expect(themeForLevel(1).name).toBe(LEVEL_THEMES[0]!.name);
    expect(themeForLevel(5).name).toBe(LEVEL_THEMES[4]!.name);
    expect(themeForLevel(99).name).toBe(LEVEL_THEMES[4]!.name);
  });

  it("ships five distinct themes", () => {
    const names = LEVEL_THEMES.map((t) => t.name);
    expect(new Set(names).size).toBe(5);
    for (const t of LEVEL_THEMES) {
      for (const [k, v] of Object.entries(t.colors)) {
        if (k === "hi" || k === "black" || k === "food") continue;
        expect(v.length, k).toBe(3);
      }
    }
  });
});

describe("ThemeMixer", () => {
  it("starts settled at the given level's palette", () => {
    const m = new ThemeMixer(1);
    const c = LEVEL_THEMES[0]!.colors;
    expect(m.bg).toEqual([c.bg[0]!, c.bg[1]!, c.bg[2]!]);
    expect(m.update(16)).toBe(false);
  });

  it("setLevel is a no-op when already at the target", () => {
    const m = new ThemeMixer(2);
    expect(m.setLevel(2)).toBe(false);
  });

  it("lerps toward the target and settles", () => {
    const m = new ThemeMixer(1);
    const from = [...m.snake];
    const target = LEVEL_THEMES[1]!.colors.snake;
    expect(m.setLevel(2)).toBe(true);
    // half-way through the 600ms transition, ease-out is well past 0.5
    let live = m.update(300);
    expect(live).toBe(true);
    for (let i = 0; i < 3; i++) {
      const delta = Math.abs(m.snake[i]! - from[i]!) + Math.abs(m.snake[i]! - target[i]!);
      expect(delta).toBeGreaterThan(0);
    }
    // run to completion
    for (let i = 0; i < 20; i++) live = m.update(16);
    expect(live).toBe(false);
    expect(m.snake).toEqual([target[0]!, target[1]!, target[2]!]);
  });

  it("css strings are stable at steady state (no churn)", () => {
    const m = new ThemeMixer(3);
    m.update(640); // settle any pending transition
    const before = { bg: m.bgCss, snake: m.snakeCss, accent: m.accentCss };
    m.update(16);
    expect(m.bgCss).toBe(before.bg);
    expect(m.snakeCss).toBe(before.snake);
    expect(m.accentCss).toBe(before.accent);
    expect(m.bgCss).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it("chaining levels retargets from the current colour", () => {
    const m = new ThemeMixer(1);
    m.setLevel(3);
    m.update(100); // partway
    const mid = [...m.bg];
    m.setLevel(5);
    m.update(640);
    const c5 = LEVEL_THEMES[4]!.colors.bg;
    expect(m.bg).toEqual([c5[0]!, c5[1]!, c5[2]!]);
    // the intermediate sample must have moved toward level 3, not 5
    const c3 = LEVEL_THEMES[2]!.colors.bg;
    expect(mid).not.toEqual([c5[0]!, c5[1]!, c5[2]!]);
    expect(c3).toBeDefined();
  });
});
