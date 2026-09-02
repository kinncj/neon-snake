import { describe, expect, it } from "vitest";
import { FOOD_VALUE, GRID_H, GRID_W } from "../../app/domain/types";
import type { State } from "../../app/domain/types";
import { init, makeSink, step } from "../../app/domain/step";

function placeFood(s: State, x: number, y: number): void {
  (s.food as { x: number; y: number }).x = x;
  (s.food as { x: number; y: number }).y = y;
}

function foodOnBody(s: State): boolean {
  for (let i = 0; i < s.bodyLen; i++) {
    const c = s.body[i]!;
    if (c.x === s.food.x && c.y === s.food.y) return true;
  }
  return false;
}

describe("step: eating", () => {
  it("length 3 -> 4, score increases by FOOD_VALUE, effects in order", () => {
    const s = init("food-test-01");
    const sink = makeSink(16);
    const hx = s.body[0]!.x;
    const hy = s.body[0]!.y;
    placeFood(s, hx + 1, hy); // one cell ahead, snake faces right
    const before = { len: s.bodyLen, score: s.score };
    expect(before.len).toBe(3);
    expect(before.score).toBe(0);

    step(s, sink);

    expect(s.bodyLen).toBe(4);
    expect(s.score).toBe(FOOD_VALUE);
    expect(s.body[0]!.x).toBe(hx + 1);
    expect(s.body[0]!.y).toBe(hy);
    expect(sink.count).toBe(3);
    expect(sink.items[0]).toMatchObject({ kind: "ate" });
    expect(sink.items[1]).toMatchObject({ kind: "grew" });
    expect(sink.items[2]).toMatchObject({ kind: "spawned" });
    const eaten = { x: hx + 1, y: hy };
    for (const e of [sink.items[0]!, sink.items[1]!]) {
      expect([e.x, e.y]).toEqual([eaten.x, eaten.y]);
    }
    // tail cell kept: growth does not vacate it
    expect([s.body[3]!.x, s.body[3]!.y]).toEqual([14, 15]);
    // new food is off the body
    expect(foodOnBody(s)).toBe(false);
  });

  it("growth extends the tail by one cell per eat", () => {
    const s = init("food-test-02");
    const sink = makeSink(16);
    // eat twice in a row by repositioning food ahead of the head
    for (let i = 0; i < 2; i++) {
      placeFood(s, s.body[0]!.x + 1, s.body[0]!.y);
      step(s, sink);
      sink.count = 0;
    }
    expect(s.bodyLen).toBe(5);
    // Phase 2 combo: two back-to-back eats inside the window score
    // 10*1 + 10*2 (the second eat runs at combo x2).
    expect(s.score).toBe(FOOD_VALUE * 1 + FOOD_VALUE * 2);
    // body is contiguous: each cell one step behind the previous
    for (let i = 1; i < s.bodyLen; i++) {
      const a = s.body[i - 1]!;
      const b = s.body[i]!;
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
    }
    expect(foodOnBody(s)).toBe(false);
  });
});

describe("food spawning", () => {
  it("food never lands on the body across 1000 seeded spawns", () => {
    for (let i = 0; i < 1000; i++) {
      const s = init(`spawn-${String(i).padStart(4, "0")}`);
      expect(foodOnBody(s)).toBe(false);
      expect(s.food.x).toBeGreaterThanOrEqual(0);
      expect(s.food.x).toBeLessThan(GRID_W);
      expect(s.food.y).toBeGreaterThanOrEqual(0);
      expect(s.food.y).toBeLessThan(GRID_H);
    }
  });

  it("food never lands on the body during a 51-eat loop", () => {
    // The straight path hits the wall at x=31, so run a 13-cell square loop
    // (perimeter 52). Two extra eats are safe because the initial tail cells
    // (15,15),(14,15) sit off the loop; the 52nd eat closes on the tail and
    // must self-collide.
    const s = init("food-chain-01");
    const sink = makeSink(16);
    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];
    const turnEvery = 13;
    const nextDirs = [2, 3, 0, 1]; // right -> down -> left -> up
    for (let i = 0; i < 51; i++) {
      const h = s.body[0]!;
      placeFood(s, h.x + dx[s.dir]!, h.y + dy[s.dir]!);
      step(s, sink);
      sink.count = 0;
      expect(foodOnBody(s)).toBe(false);
      if ((i + 1) % turnEvery === 0) {
        (s as unknown as { dir: number }).dir = nextDirs[Math.floor((i + 1) / turnEvery) - 1]!;
      }
    }
    expect(s.bodyLen).toBe(54);
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([16, 16]);
    // the 52nd eat lands on the tail cell and kills the snake
    placeFood(s, s.body[0]!.x, s.body[0]!.y - 1);
    step(s, sink);
    expect(s.phase).toBe("gameover");
    expect(sink.count).toBe(1);
    expect(sink.items[0]!.kind).toBe("died");
  });

  it("256-attempt cap then linear scan: full grid ends the game deterministically", () => {
    // Occupy all 960 cells except (1,0); head at (0,0) facing right with
    // food at the only free cell. The eat grows the snake to 960, so the
    // respawn scan finds nothing and the phase terminates.
    const s = init("fallback-01");
    const m = s as unknown as {
      body: { x: number; y: number }[];
      bodyLen: number;
      dir: number;
      food: { x: number; y: number };
    };
    let k = 0;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (x === 1 && y === 0) continue;
        m.body[k]!.x = x;
        m.body[k]!.y = y;
        k++;
      }
    }
    m.bodyLen = k;
    expect(m.body[0]!.x).toBe(0); // head lands at (0,0)
    expect(m.body[0]!.y).toBe(0);
    m.dir = 1;
    m.food.x = 1;
    m.food.y = 0;
    const sink = makeSink(8);
    step(s, sink);
    expect(s.bodyLen).toBe(960);
    expect(s.phase).toBe("gameover");
    // sink got ate+grew+spawned before terminating
    expect(sink.count).toBe(3);
  });
});
