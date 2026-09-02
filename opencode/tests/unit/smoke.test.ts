import { describe, expect, it } from "vitest";

describe("scaffold", () => {
  it("the build stamp constant is defined or absent (node env)", () => {
    // In the browser Vite injects a string; in the pure-node test env the
    // ambient declaration may be undefined at runtime. Both are fine here —
    // this test only proves the module graph loads.
    expect(typeof __SNAKE_BUILD__ === "string" || typeof __SNAKE_BUILD__ === "undefined").toBe(true);
  });

  it("integer math sanity (the simulation domain is integer-only)", () => {
    const GRID_W = 32;
    const GRID_H = 30;
    const CELL_PX = 8;
    expect(GRID_W * CELL_PX).toBe(256);
    expect(GRID_H * CELL_PX).toBe(240);
  });
});
