import { describe, it, expect } from "vitest";
import { init, step } from "../../app/domain/step";
import { createSink, effectAt, resetSink, cellX, cellY, EFFECT_ATE, EFFECT_LEVELUP, DIR_DX, DIR_DY } from "../../app/domain/types";
import { COMBO_WINDOW_TICKS, LEVEL_SCORES } from "../../app/domain/levels";

/** Steps once with the food parked directly ahead, so the tick is an eat. */
function eat(s: ReturnType<typeof init>, sink: ReturnType<typeof createSink>): void {
  const h = s.body[0]!;
  s.foodX = cellX(h) + DIR_DX[s.dir]!;
  s.foodY = cellY(h) + DIR_DY[s.dir]!;
  resetSink(sink);
  step(s, sink);
}

/** Steps `n` times with the food parked far away in a corner. */
function coast(s: ReturnType<typeof init>, sink: ReturnType<typeof createSink>, n: number): void {
  for (let i = 0; i < n; i++) {
    s.foodX = 0;
    s.foodY = 0;
    resetSink(sink);
    step(s, sink);
  }
}

function findKind(sink: ReturnType<typeof createSink>, kind: number): number {
  for (let i = 0; i < sink.len; i++) if (sink.kind[effectAt(sink, i)] === kind) return effectAt(sink, i);
  return -1;
}

describe("progression", () => {
  it("chained eats build a combo up to x4 and the multiplier is in the ate payload", () => {
    const s = init("combo");
    const sink = createSink();
    // Walk the snake left so it has room: start heading right at x=16 with 15 cells ahead.
    eat(s, sink);
    expect(s.combo).toBe(1);
    expect(sink.arg[findKind(sink, EFFECT_ATE)]).toBe(10);
    eat(s, sink);
    expect(s.combo).toBe(2);
    expect(sink.arg[findKind(sink, EFFECT_ATE)]).toBe(20);
    eat(s, sink);
    expect(s.combo).toBe(3);
    eat(s, sink);
    expect(s.combo).toBe(4);
    eat(s, sink);
    expect(s.combo).toBe(4); // capped
    expect(s.score).toBe(10 + 20 + 30 + 40 + 40);
  });

  it("the combo resets when the window closes", () => {
    const s = init("combo");
    const sink = createSink();
    eat(s, sink);
    coast(s, sink, COMBO_WINDOW_TICKS - 1); // next eat lands exactly WINDOW ticks later
    eat(s, sink);
    expect(s.combo).toBe(2); // exactly at the window edge still counts
    coast(s, sink, COMBO_WINDOW_TICKS); // next eat lands WINDOW + 1 ticks later
    eat(s, sink);
    expect(s.combo).toBe(1);
  });

  it("levelling up is re-derived from score and emits levelup once per level", () => {
    const s = init("level");
    const sink = createSink();
    s.score = LEVEL_SCORES[1]! - 10; // one apple short of level 2
    coast(s, sink, 1);
    expect(s.level).toBe(1);
    // Eat one apple (x1 combo since the window has long passed): crosses the threshold.
    s.lastEatTick = -1;
    eat(s, sink);
    expect(s.level).toBe(2);
    const i = findKind(sink, EFFECT_LEVELUP);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(sink.arg[i]).toBe(2);
    coast(s, sink, 1);
    expect(findKind(sink, EFFECT_LEVELUP)).toBe(-1);
  });

  it("food value follows the level", () => {
    const s = init("value");
    const sink = createSink();
    s.score = LEVEL_SCORES[2]!; // level 3 -> orange
    coast(s, sink, 1);
    expect(s.level).toBe(3);
    eat(s, sink);
    expect(sink.arg[findKind(sink, EFFECT_ATE)]).toBe(20);
    s.score = LEVEL_SCORES[4]!;
    s.lastEatTick = -1;
    coast(s, sink, 1);
    expect(s.level).toBe(5);
    eat(s, sink);
    expect(sink.arg[findKind(sink, EFFECT_ATE)]).toBe(40);
  });
});
