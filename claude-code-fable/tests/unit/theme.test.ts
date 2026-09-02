import { describe, it, expect } from "vitest";
import {
  THEMES, themeForLevel, applyTheme, mixHex, createThemeState, updateTheme, settled, RETINT_MS
} from "../../app/adapters/render/theme";
import { BASE_PALETTE } from "../../app/adapters/render/framebuffer";

describe("themes", () => {
  it("ships five palettes with the spec accents", () => {
    expect(THEMES.map((t) => t.name)).toEqual(["midnight-cyan", "neon-magenta", "electric-violet", "tokyo-sunset", "golden-hour"]);
    expect(THEMES.map((t) => t.accent)).toEqual(["#00e5ff", "#ff2e88", "#9d6bff", "#ff7849", "#ffd166"]);
    for (const t of THEMES) for (const c of [t.bg, t.grid, t.body, t.bodyShade, t.head, t.accent]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("maps levels to themes and clamps", () => {
    expect(themeForLevel(1).name).toBe("midnight-cyan");
    expect(themeForLevel(3).name).toBe("electric-violet");
    expect(themeForLevel(5).name).toBe("golden-hour");
    expect(themeForLevel(0).name).toBe("midnight-cyan");
    expect(themeForLevel(9).name).toBe("golden-hour");
  });
  it("applyTheme keeps the non-themed base colours", () => {
    const p = applyTheme(themeForLevel(2), { ...BASE_PALETTE });
    expect(p.accent).toBe("#ff2e88");
    expect(p.fruit).toBe(BASE_PALETTE.fruit);
    expect(p.eye).toBe(BASE_PALETTE.eye);
  });
  it("mixHex interpolates and clamps", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#ff0000", "#0000ff", 2)).toBe("#0000ff");
  });
  it("a level change re-tints over RETINT_MS and settles exactly on the new theme", () => {
    const ts = createThemeState(1);
    expect(settled(ts)).toBe(true);
    expect(ts.palette.accent).toBe("#00e5ff");
    updateTheme(ts, 2, 0);
    expect(settled(ts)).toBe(false);
    updateTheme(ts, 2, RETINT_MS / 2);
    expect(ts.palette.accent).not.toBe("#00e5ff");
    expect(ts.palette.accent).not.toBe("#ff2e88");
    updateTheme(ts, 2, RETINT_MS);
    expect(settled(ts)).toBe(true);
    expect(ts.palette.accent).toBe("#ff2e88");
    expect(ts.palette.bg).toBe(themeForLevel(2).bg);
  });
  it("does not allocate a new palette object across frames", () => {
    const ts = createThemeState(1);
    const p = ts.palette;
    for (let i = 0; i < 100; i++) expect(updateTheme(ts, (i % 5) + 1, 16)).toBe(p);
  });
});
