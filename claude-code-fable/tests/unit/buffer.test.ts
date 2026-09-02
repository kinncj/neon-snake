import { describe, it, expect } from "vitest";
import {
  createSink, emit, effectAt, resetSink, EFFECT_ATE, EFFECT_DIED, EFFECT_TURNED,
  packCell, cellX, cellY, opposite, intentKind, intentDir, INTENT_PAUSE, INTENT_RESTART, turnIntent,
  GRID_W, GRID_H, CELL_PX, FB_W, FB_H
} from "../../app/domain/types";

describe("effect sink ring", () => {
  it("appends in order until full", () => {
    const s = createSink(4);
    emit(s, EFFECT_ATE, 1, 2, 10);
    emit(s, EFFECT_TURNED, 3, 4, 2);
    expect(s.len).toBe(2);
    expect(s.kind[effectAt(s, 0)]).toBe(EFFECT_ATE);
    expect(s.arg[effectAt(s, 0)]).toBe(10);
    expect(s.kind[effectAt(s, 1)]).toBe(EFFECT_TURNED);
    expect(s.x[effectAt(s, 1)]).toBe(3);
    expect(s.y[effectAt(s, 1)]).toBe(4);
  });

  it("evicts the oldest on overflow and counts the drop", () => {
    const s = createSink(3);
    for (let i = 0; i < 5; i++) emit(s, EFFECT_DIED, i, 0, i);
    expect(s.len).toBe(3);
    expect(s.dropped).toBe(2);
    expect([0, 1, 2].map((i) => s.arg[effectAt(s, i)])).toEqual([2, 3, 4]);
  });

  it("resets without allocating", () => {
    const s = createSink(2);
    const kind = s.kind;
    emit(s, EFFECT_ATE, 0, 0);
    resetSink(s);
    expect(s.len).toBe(0);
    expect(s.head).toBe(0);
    expect(s.kind).toBe(kind);
  });
});

describe("grid and cell packing", () => {
  it("has the spec dimensions", () => {
    expect([GRID_W, GRID_H, CELL_PX, FB_W, FB_H]).toEqual([32, 30, 8, 256, 240]);
  });
  it("round-trips every cell", () => {
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const c = packCell(x, y);
        expect(cellX(c)).toBe(x);
        expect(cellY(c)).toBe(y);
      }
    }
  });
  it("opposite direction is a 180 degree turn", () => {
    expect(opposite(0)).toBe(2);
    expect(opposite(1)).toBe(3);
    expect(opposite(2)).toBe(0);
    expect(opposite(3)).toBe(1);
  });
});

describe("intent encoding", () => {
  it("classifies turns, pause and restart", () => {
    expect(intentKind(turnIntent(3))).toBe("turn");
    expect(intentDir(turnIntent(3))).toBe(3);
    expect(intentKind(INTENT_PAUSE)).toBe("pause");
    expect(intentKind(INTENT_RESTART)).toBe("restart");
  });
});
