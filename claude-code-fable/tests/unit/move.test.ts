import { describe, it, expect } from "vitest";
import { init, step, reset } from "../../app/domain/step";
import { enqueueTurn } from "../../app/domain/intents";
import {
  createSink, effectAt, resetSink, cellX, cellY, packCell,
  EFFECT_TURNED, GRID_W, GRID_H, START_LEN
} from "../../app/domain/types";

const headXY = (s: ReturnType<typeof init>) => [cellX(s.body[0]!), cellY(s.body[0]!)];

describe("init", () => {
  it("places a 3-cell snake at the centre heading right", () => {
    const s = init("snake-0001");
    expect(s.bodyLen).toBe(START_LEN);
    expect(headXY(s)).toEqual([GRID_W >> 1, GRID_H >> 1]);
    expect([cellX(s.body[1]!), cellY(s.body[1]!)]).toEqual([(GRID_W >> 1) - 1, GRID_H >> 1]);
    expect(s.dir).toBe(0);
    expect(s.phase).toBe("playing");
    expect(s.tick).toBe(0);
    expect(s.rng).not.toBe(0);
  });
  it("is deterministic for the same seed", () => {
    const a = init("x");
    const b = init("x");
    expect(a.seed).toBe(b.seed);
    expect(Array.from(a.body)).toEqual(Array.from(b.body));
  });
});

describe("movement", () => {
  it("moves the head one cell per tick and shifts the body by index", () => {
    const s = init("snake-0001");
    const sink = createSink();
    const before = Array.from(s.body.subarray(0, s.bodyLen));
    const body = s.body;
    step(s, sink);
    expect(s.body).toBe(body); // no allocation
    expect(s.tick).toBe(1);
    expect(headXY(s)).toEqual([(GRID_W >> 1) + 1, GRID_H >> 1]);
    expect(Array.from(s.body.subarray(1, s.bodyLen))).toEqual(before.slice(0, START_LEN - 1));
  });
  it("applies one pending turn per tick and emits turned", () => {
    const s = init("snake-0001");
    const sink = createSink();
    enqueueTurn(s, 1); // down
    enqueueTurn(s, 2); // then left
    step(s, sink);
    expect(s.dir).toBe(1);
    expect(sink.len).toBe(1);
    expect(sink.kind[effectAt(sink, 0)]).toBe(EFFECT_TURNED);
    expect(sink.arg[effectAt(sink, 0)]).toBe(1);
    expect(s.pendingLen).toBe(1);
    expect(headXY(s)).toEqual([GRID_W >> 1, (GRID_H >> 1) + 1]);
    resetSink(sink);
    step(s, sink);
    expect(s.dir).toBe(2);
    expect(s.pendingLen).toBe(0);
    expect(headXY(s)).toEqual([(GRID_W >> 1) - 1, (GRID_H >> 1) + 1]);
  });
  it("does not move when paused", () => {
    const s = init("snake-0001");
    const sink = createSink();
    s.phase = "paused";
    const before = Array.from(s.body);
    step(s, sink);
    expect(s.tick).toBe(0);
    expect(Array.from(s.body)).toEqual(before);
    expect(sink.len).toBe(0);
  });
  it("reset restores the initial layout in place", () => {
    const s = init("snake-0001");
    const sink = createSink();
    for (let i = 0; i < 5; i++) step(s, sink);
    const body = s.body;
    reset(s);
    expect(s.body).toBe(body);
    expect(s.tick).toBe(0);
    expect(s.body[0]).toBe(packCell(GRID_W >> 1, GRID_H >> 1));
  });
});
