import { describe, it, expect } from "vitest";
import { init, step, apply } from "../../app/domain/step";
import {
  createSink, effectAt, resetSink, cellX, cellY, packCell,
  EFFECT_DIED, CAUSE_WALL, CAUSE_SELF, GRID_W, GRID_H,
  INTENT_PAUSE, INTENT_RESTART, turnIntent, START_LEN
} from "../../app/domain/types";

function runUntilDead(s: ReturnType<typeof init>, sink: ReturnType<typeof createSink>, max = 100): number {
  let n = 0;
  while (s.phase === "playing" && n < max) {
    resetSink(sink);
    step(s, sink);
    n++;
  }
  return n;
}

describe("collision", () => {
  it("dies on the right wall with cause wall at the head cell", () => {
    const s = init("snake-0001");
    const sink = createSink();
    s.foodY = 0; // keep the food off the centre row
    const startX = cellX(s.body[0]!);
    const ticks = runUntilDead(s, sink);
    expect(s.phase).toBe("gameover");
    expect(ticks).toBe(GRID_W - startX);
    expect(sink.len).toBe(1);
    const i = effectAt(sink, 0);
    expect(sink.kind[i]).toBe(EFFECT_DIED);
    expect(sink.arg[i]).toBe(CAUSE_WALL);
    expect([sink.x[i], sink.y[i]]).toEqual([GRID_W - 1, GRID_H >> 1]);
    // The head never leaves the grid.
    expect(cellX(s.body[0]!)).toBe(GRID_W - 1);
  });

  it("dies on every wall", () => {
    for (const [dir, cx, cy] of [[3, 0, 0], [2, 0, 0], [1, 5, GRID_H - 1]] as const) {
      const s = init("w");
      const sink = createSink();
      s.dir = dir;
      s.body[0] = packCell(cx, cy);
      s.body[1] = packCell(cx + 1, cy);
      s.body[2] = packCell(cx + 2, cy);
      s.foodX = 20; s.foodY = 20;
      step(s, sink);
      expect(s.phase).toBe("gameover");
      expect(sink.arg[effectAt(sink, 0)]).toBe(CAUSE_WALL);
    }
  });

  it("dies on self collision with cause self", () => {
    const s = init("snake-0001");
    const sink = createSink();
    // A 6-long snake folded so that a turn bites the middle of the body.
    const cells = [[10, 10], [9, 10], [9, 9], [8, 9], [8, 10], [7, 10]];
    cells.forEach(([x, y], i) => { s.body[i] = packCell(x!, y!); });
    s.bodyLen = cells.length;
    s.foodX = 30; s.foodY = 29;
    apply(s, turnIntent(3)); // up into (10,9): free
    step(s, sink);
    expect(s.phase).toBe("playing");
    resetSink(sink);
    // Heading up at (10,9); (9,9) is now body[3].
    apply(s, turnIntent(2)); // left into (9,9): occupied
    step(s, sink);
    expect(s.phase).toBe("gameover");
    expect(sink.len).toBe(2); // turned, then died
    const i = effectAt(sink, 1);
    expect(sink.kind[i]).toBe(EFFECT_DIED);
    expect(sink.arg[i]).toBe(CAUSE_SELF);
    expect([sink.x[i], sink.y[i]]).toEqual([10, 9]);
  });

  it("gameover is terminal: step returns the same state and emits nothing", () => {
    const s = init("snake-0001");
    const sink = createSink();
    s.foodY = 0;
    runUntilDead(s, sink);
    const snapshot = Array.from(s.body.subarray(0, s.bodyLen));
    const tick = s.tick;
    resetSink(sink);
    const r = step(s, sink);
    expect(r).toBe(s);
    expect(s.tick).toBe(tick);
    expect(Array.from(s.body.subarray(0, s.bodyLen))).toEqual(snapshot);
    expect(sink.len).toBe(0);
  });

  it("pause toggles and freezes the simulation", () => {
    const s = init("snake-0001");
    const sink = createSink();
    apply(s, INTENT_PAUSE);
    expect(s.phase).toBe("paused");
    step(s, sink);
    expect(s.tick).toBe(0);
    apply(s, INTENT_PAUSE);
    expect(s.phase).toBe("playing");
    step(s, sink);
    expect(s.tick).toBe(1);
  });

  it("restart re-inits with the same seed from gameover", () => {
    const s = init("snake-0001");
    const fresh = init("snake-0001");
    const sink = createSink();
    s.foodY = 0;
    runUntilDead(s, sink);
    expect(apply(s, INTENT_RESTART)).toBe(true);
    expect(s.phase).toBe("playing");
    expect(s.tick).toBe(0);
    expect(s.bodyLen).toBe(START_LEN);
    expect(s.seed).toBe(fresh.seed);
    expect([s.foodX, s.foodY, s.rng]).toEqual([fresh.foodX, fresh.foodY, fresh.rng]);
    expect(cellY(s.body[0]!)).toBe(GRID_H >> 1);
  });
});
