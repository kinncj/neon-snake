import { describe, expect, it } from "vitest";
import { enqueue } from "../../app/domain/intents";
import { init, makeSink, step } from "../../app/domain/step";
import { GRID_H, GRID_W } from "../../app/domain/types";
import type { Dir } from "../../app/domain/types";
import { makeState, placeBody } from "./support/mut-state";

describe("init", () => {
  it("starts the snake at the centre facing right, length 3", () => {
    const s = init("snake-0001");
    const cx = GRID_W >> 1;
    const cy = GRID_H >> 1;
    expect(s.body[0]!.x).toBe(cx);
    expect(s.body[0]!.y).toBe(cy);
    expect(s.body[1]!.x).toBe(cx - 1);
    expect(s.body[1]!.y).toBe(cy);
    expect(s.body[2]!.x).toBe(cx - 2);
    expect(s.body[2]!.y).toBe(cy);
    expect(s.bodyLen).toBe(3);
    expect(s.dir).toBe(1);
    expect(s.tick).toBe(0);
    expect(s.phase).toBe("playing");
    expect(s.pendingLen).toBe(0);
    expect(s.score).toBe(0);
    expect(s.best).toBe(0);
  });

  it("spawns food on a free cell, deterministically per seed", () => {
    const a = init("snake-0001");
    const b = init("snake-0001");
    expect(a.food.x).toBe(b.food.x);
    expect(a.food.y).toBe(b.food.y);
    expect(a.rng).toBe(b.rng);
    for (let i = 0; i < a.bodyLen; i++) {
      const c = a.body[i]!;
      expect(a.food.x === c.x && a.food.y === c.y).toBe(false);
    }
  });

  it("allocates the fixed-capacity body (no growth allocation later)", () => {
    const s = init("snake-0001");
    expect(s.body.length).toBe(GRID_W * GRID_H);
  });
});

describe("movement", () => {
  it("moves the head one cell in dir and the body follows", () => {
    const s = makeState();
    placeBody(s, [
      [10, 10],
      [9, 10],
      [8, 10]
    ]);
    const sink = makeSink(8);
    step(s, sink);
    expect(s.body[0]!.x).toBe(11);
    expect(s.body[0]!.y).toBe(10);
    expect(s.body[1]!.x).toBe(10);
    expect(s.body[1]!.y).toBe(10);
    expect(s.body[2]!.x).toBe(9);
    expect(s.tick).toBe(1);
  });

  it("each direction moves the head by exactly its vector", () => {
    const vec: Array<[Dir, number, number]> = [
      [0, 0, -1],
      [1, 1, 0],
      [2, 0, 1],
      [3, -1, 0]
    ];
    for (const [d, dx, dy] of vec) {
      const s = makeState({ dir: d });
      placeBody(s, [
        [16, 15],
        [0, 0],
        [0, 1]
      ]);
      const sink = makeSink(8);
      step(s, sink);
      expect(s.body[0]!.x).toBe(16 + dx);
      expect(s.body[0]!.y).toBe(15 + dy);
      sink.count = 0;
    }
  });

  it("consumes one pending direction per tick and emits turned at the old head", () => {
    const s = makeState({ dir: 1 });
    placeBody(s, [
      [10, 10],
      [9, 10],
      [8, 10]
    ]);
    enqueue(s, { kind: "turn", dir: 2 });
    const sink = makeSink(8);
    step(s, sink);
    expect(s.dir).toBe(2);
    expect(s.pendingLen).toBe(0);
    expect(sink.count).toBe(1);
    expect(sink.items[0]!.kind).toBe("turned");
    expect(sink.items[0]!.x).toBe(10);
    expect(sink.items[0]!.y).toBe(10);
    expect(s.body[0]!.x).toBe(10);
    expect(s.body[0]!.y).toBe(11);
  });

  it("a second buffered direction is consumed on the next tick", () => {
    const s = makeState({ dir: 1 });
    placeBody(s, [
      [10, 10],
      [9, 10],
      [8, 10]
    ]);
    enqueue(s, { kind: "turn", dir: 2 });
    enqueue(s, { kind: "turn", dir: 3 });
    const sink = makeSink(8);
    step(s, sink);
    expect(s.dir).toBe(2);
    sink.count = 0;
    step(s, sink);
    expect(s.dir).toBe(3);
    expect(s.body[0]!.x).toBe(9);
    expect(s.body[0]!.y).toBe(11);
  });

  it("walls are solid (no wrap): the head never leaves the field", () => {
    const atWall: Array<[Dir, number, number]> = [
      [0, 16, 0],
      [1, GRID_W - 1, 15],
      [2, 16, GRID_H - 1],
      [3, 0, 15]
    ];
    for (const [d, x, y] of atWall) {
      const s = makeState({ dir: d });
      placeBody(s, [
        [x, y],
        [1, 1],
        [1, 2]
      ]);
      const sink = makeSink(8);
      step(s, sink);
      expect(s.body[0]!.x).toBeGreaterThanOrEqual(0);
      expect(s.body[0]!.x).toBeLessThan(GRID_W);
      expect(s.body[0]!.y).toBeGreaterThanOrEqual(0);
      expect(s.body[0]!.y).toBeLessThan(GRID_H);
      sink.count = 0;
    }
  });
});
