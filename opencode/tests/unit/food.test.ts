import { describe, expect, it } from "vitest";
import { init, makeSink, step } from "../../app/domain/step";
import { BODY_CAP, FOOD_VALUE, GRID_W } from "../../app/domain/types";
import { makeState, placeBody, setFood } from "./support/mut-state";

describe("food", () => {
  it("eating grows the snake by one and scores the base value", () => {
    const s = makeState({ dir: 1 });
    placeBody(s, [
      [10, 10],
      [9, 10],
      [8, 10]
    ]);
    setFood(s, 11, 10);
    const sink = makeSink(8);
    step(s, sink);
    expect(s.bodyLen).toBe(4);
    expect(s.score).toBe(FOOD_VALUE);
    expect(s.best).toBe(FOOD_VALUE);
  });

  it("emits ate, grew and spawned at the right cells", () => {
    const s = makeState({ dir: 1 });
    placeBody(s, [
      [10, 10],
      [9, 10],
      [8, 10]
    ]);
    setFood(s, 11, 10);
    const sink = makeSink(8);
    step(s, sink);
    const kinds = sink.items.slice(0, sink.count).map((e) => e.kind);
    expect(kinds).toEqual(["ate", "grew", "spawned"]);
    expect(sink.items[0]!.x).toBe(11); // ate at the eaten cell
    expect(sink.items[0]!.y).toBe(10);
    const sp = sink.items[sink.count - 1]!;
    // spawned at the new food, off the body
    for (let i = 0; i < s.bodyLen; i++) {
      const c = s.body[i]!;
      expect(sp.x === c.x && sp.y === c.y).toBe(false);
    }
  });

  it("on growth the tail cell is kept (no tail shift this tick)", () => {
    const s = makeState({ dir: 1 });
    placeBody(s, [
      [10, 10],
      [9, 10],
      [8, 10]
    ]);
    setFood(s, 11, 10);
    const sink = makeSink(8);
    step(s, sink);
    // old tail (8,10) is still part of the snake
    expect(s.body[3]!.x).toBe(8);
    expect(s.body[3]!.y).toBe(10);
    sink.count = 0;
  });

  it("without eating the tail cell is vacated", () => {
    const s = makeState({ dir: 1 });
    placeBody(s, [
      [10, 10],
      [9, 10],
      [8, 10]
    ]);
    setFood(s, 0, 0);
    const sink = makeSink(8);
    step(s, sink);
    expect(s.bodyLen).toBe(3);
    expect(s.body[2]!.x).toBe(9); // old head, old tail gone
  });

  it("new food never spawns on the body", () => {
    const s = makeState({ dir: 1, rng: 0xdeadbeef });
    placeBody(s, [
      [10, 10],
      [9, 10],
      [8, 10]
    ]);
    setFood(s, 11, 10);
    const sink = makeSink(16);
    for (let i = 0; i < 50; i++) {
      step(s, sink);
      sink.count = 0;
      // after an eat, the freshly spawned food must be off the body;
      // after a plain move, food is untouched and stays off the body
      // (the head just walked the row it was walking).
      for (let j = 0; j < s.bodyLen; j++) {
        const c = s.body[j]!;
        expect(s.food.x === c.x && s.food.y === c.y).toBe(false);
      }
      // park the food ahead of the head again if it was eaten
      if (s.score > 0) {
        // the snake keeps moving right along y=10; keep food clear
      }
    }
  });

  it("on a nearly full grid the spawn lands on the only free cell", () => {
    // Fill every cell except (0,0) and (1,0); head at (0,1) facing up, food
    // at (0,0). After the eat, exactly one cell is free, so whatever path
    // the sampler takes (256 rejection draws or the linear scan fallback)
    // the spawn must land on (1,0).
    const s = makeState({ dir: 0, rng: 0x01234567 });
    const cells: Array<[number, number]> = [[0, 1]]; // head first
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (x === 0 && y === 0) continue; // the food cell
        if (x === 1 && y === 0) continue; // the only cell left free after
        if (x === 0 && y === 1) continue; // head, already added
        cells.push([x, y]);
      }
    }
    placeBody(s, cells);
    expect(s.bodyLen).toBe(BODY_CAP - 2);
    setFood(s, 0, 0);
    const sink = makeSink(16);
    step(s, sink);
    expect(s.phase).toBe("playing");
    expect(s.bodyLen).toBe(BODY_CAP - 1);
    expect(s.food.x).toBe(1);
    expect(s.food.y).toBe(0);
    sink.count = 0;
  });

  it("a fully occupied grid is a terminal gameover", () => {
    // Every cell except the food; eating it fills the last cell.
    const s = makeState({ dir: 0, rng: 0x01234567 });
    const cells: Array<[number, number]> = [[0, 1]]; // head
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (x === 0 && y === 0) continue; // the food cell
        if (x === 0 && y === 1) continue; // head, already added
        cells.push([x, y]);
      }
    }
    placeBody(s, cells);
    expect(s.bodyLen).toBe(BODY_CAP - 1);
    setFood(s, 0, 0);
    const sink = makeSink(16);
    step(s, sink);
    expect(s.bodyLen).toBe(BODY_CAP);
    expect(s.phase).toBe("gameover");
    sink.count = 0;
  });

  it("init food is deterministic for a given seed", () => {
    const a = init("seed-food");
    const b = init("seed-food");
    expect([a.food.x, a.food.y]).toEqual([b.food.x, b.food.y]);
  });
});
