import { describe, it, expect } from "vitest";
import { init, step, spawnFood, FOOD_VALUE } from "../../app/domain/step";
import {
  createSink, effectAt, cellX, cellY, packCell,
  EFFECT_ATE, EFFECT_GREW, EFFECT_SPAWNED, GRID_W, GRID_H, CELL_COUNT, START_LEN
} from "../../app/domain/types";

function kinds(sink: ReturnType<typeof createSink>): number[] {
  const out: number[] = [];
  for (let i = 0; i < sink.len; i++) out.push(sink.kind[effectAt(sink, i)]!);
  return out;
}

describe("food", () => {
  it("spawns on an unoccupied cell inside the grid", () => {
    const s = init("snake-0001");
    for (let n = 0; n < 200; n++) {
      expect(spawnFood(s)).toBe(true);
      expect(s.foodX).toBeGreaterThanOrEqual(0);
      expect(s.foodX).toBeLessThan(GRID_W);
      expect(s.foodY).toBeGreaterThanOrEqual(0);
      expect(s.foodY).toBeLessThan(GRID_H);
      const cell = packCell(s.foodX, s.foodY);
      for (let i = 0; i < s.bodyLen; i++) expect(s.body[i]).not.toBe(cell);
    }
  });

  it("spawn advances the rng deterministically", () => {
    const a = init("seed-z");
    const b = init("seed-z");
    expect([a.foodX, a.foodY]).toEqual([b.foodX, b.foodY]);
    spawnFood(a);
    spawnFood(b);
    expect([a.foodX, a.foodY, a.rng]).toEqual([b.foodX, b.foodY, b.rng]);
  });

  it("falls back to a linear scan when the grid is nearly full", () => {
    const s = init("full");
    // Fill every cell except one with the body.
    let n = 0;
    for (let c = 0; c < CELL_COUNT; c++) {
      if (c === packCell(5, 7)) continue;
      s.body[n++] = c;
    }
    s.bodyLen = n;
    expect(spawnFood(s)).toBe(true);
    expect([s.foodX, s.foodY]).toEqual([5, 7]);
    s.body[n++] = packCell(5, 7);
    s.bodyLen = n;
    expect(spawnFood(s)).toBe(false);
  });

  it("eating grows by one, scores, and emits ate + grew + spawned", () => {
    const s = init("snake-0001");
    const sink = createSink();
    // Put the food directly ahead of the head.
    const hx = cellX(s.body[0]!);
    const hy = cellY(s.body[0]!);
    s.foodX = hx + 1;
    s.foodY = hy;
    const tail = s.body[START_LEN - 1]!;
    step(s, sink);
    expect(s.bodyLen).toBe(START_LEN + 1);
    expect(s.score).toBe(FOOD_VALUE);
    expect(s.lastEatTick).toBe(1);
    expect(s.body[s.bodyLen - 1]).toBe(tail); // old tail held in place
    expect(kinds(sink)).toEqual([EFFECT_ATE, EFFECT_GREW, EFFECT_SPAWNED]);
    expect(sink.arg[effectAt(sink, 0)]).toBe(FOOD_VALUE);
    expect(sink.x[effectAt(sink, 0)]).toBe(hx + 1);
    expect([s.foodX, s.foodY]).not.toEqual([hx + 1, hy]);
  });

  it("does not grow when passing next to food", () => {
    const s = init("snake-0001");
    const sink = createSink();
    s.foodX = cellX(s.body[0]!) + 1;
    s.foodY = cellY(s.body[0]!) + 1;
    step(s, sink);
    expect(s.bodyLen).toBe(START_LEN);
    expect(s.score).toBe(0);
    expect(sink.len).toBe(0);
  });
});
