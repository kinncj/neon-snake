import { describe, expect, it } from "vitest";
import { init, makeSink, reinit, step } from "../../app/domain/step";
import { applyIntent } from "../../app/domain/step";
import type { State } from "../../app/domain/types";

function placeFood(s: State, x: number, y: number): void {
  (s.food as { x: number; y: number }).x = x;
  (s.food as { x: number; y: number }).y = y;
}

describe("wall collision", () => {
  it("hitting the east wall ends the game and emits died at the head", () => {
    const s = init("collide-wall-01");
    const sink = makeSink(8);
    // head at (16,15) facing right: 15 safe ticks reach (31,15), the 16th
    // would land at (32,15)
    for (let i = 0; i < 15; i++) {
      step(s, sink);
      sink.count = 0;
    }
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([31, 15]);
    expect(s.phase).toBe("playing");
    step(s, sink);
    expect(s.phase).toBe("gameover");
    expect(sink.count).toBe(1);
    expect(sink.items[0]).toMatchObject({ kind: "died", x: 31, y: 15 });
    // the head did not move into the wall
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([31, 15]);
  });

  it("post-gameover ticks and intents are no-ops", () => {
    const s = init("collide-wall-02");
    const sink = makeSink(8);
    for (let i = 0; i < 16; i++) {
      step(s, sink);
      sink.count = 0;
    }
    expect(s.phase).toBe("gameover");
    const tick = s.tick;
    const score = s.score;
    const head = { x: s.body[0]!.x, y: s.body[0]!.y };
    for (let i = 0; i < 5; i++) {
      step(s, sink);
      applyIntent(s, { kind: "turn", dir: 0 });
      applyIntent(s, { kind: "pause" });
    }
    expect(sink.count).toBe(0);
    expect(s.tick).toBe(tick);
    expect(s.score).toBe(score);
    expect(s.phase).toBe("gameover");
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([head.x, head.y]);
  });
});

describe("self collision", () => {
  it("turning into the body ends the game", () => {
    const s = init("collide-self-01");
    const sink = makeSink(16);
    // eat 4 times in a straight line to the right
    for (let i = 0; i < 4; i++) {
      placeFood(s, s.body[0]!.x + 1, s.body[0]!.y);
      step(s, sink);
      sink.count = 0;
    }
    // head (20,15), body trailing to (16,15)
    expect(s.bodyLen).toBe(7);
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([20, 15]);
    applyIntent(s, { kind: "turn", dir: 0 }); // up
    applyIntent(s, { kind: "turn", dir: 3 }); // left
    step(s, sink);
    sink.count = 0;
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([20, 14]);
    step(s, sink);
    sink.count = 0;
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([19, 14]);
    applyIntent(s, { kind: "turn", dir: 2 }); // down, into (19,15) which is body
    step(s, sink);
    expect(s.phase).toBe("gameover");
    // turned (from the queued turn) then died
    expect(sink.count).toBe(2);
    expect(sink.items[0]!.kind).toBe("turned");
    expect(sink.items[1]).toMatchObject({ kind: "died", x: 19, y: 14 });
  });

  it("moving into the vacating tail cell is safe", () => {
    const s = init("collide-tail-01");
    const sink = makeSink(8);
    // length 3: head (16,15), (15,15), (14,15). up, left, down -> (15,15)
    // which the tail vacates on that same tick.
    applyIntent(s, { kind: "turn", dir: 0 });
    step(s, sink);
    sink.count = 0;
    applyIntent(s, { kind: "turn", dir: 3 });
    step(s, sink);
    sink.count = 0;
    applyIntent(s, { kind: "turn", dir: 2 });
    step(s, sink);
    expect(s.phase).toBe("playing");
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([15, 15]);
  });
});

describe("pause and restart", () => {
  it("pause freezes the simulation; second pause resumes", () => {
    const s = init("pause-01");
    const sink = makeSink(8);
    step(s, sink);
    sink.count = 0;
    expect(s.tick).toBe(1);
    applyIntent(s, { kind: "pause" });
    expect(s.phase).toBe("paused");
    for (let i = 0; i < 5; i++) {
      step(s, sink);
    }
    expect(s.phase).toBe("paused");
    expect(s.tick).toBe(1);
    expect(sink.count).toBe(0);
    applyIntent(s, { kind: "pause" });
    expect(s.phase).toBe("playing");
    step(s, sink);
    expect(s.tick).toBe(2);
  });

  it("restart re-inits in place with the same seed", () => {
    const seed = "restart-01";
    const s = init(seed);
    const sink = makeSink(8);
    // play a few ticks, then force gameover at the wall
    for (let i = 0; i < 16; i++) {
      step(s, sink);
      sink.count = 0;
    }
    expect(s.phase).toBe("gameover");
    const before = init(seed); // independent reference
    reinit(s, seed);
    expect(s.phase).toBe("playing");
    expect(s.tick).toBe(0);
    expect(s.score).toBe(0);
    expect(s.bodyLen).toBe(3);
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([16, 15]);
    expect(s.food.x).toBe(before.food.x);
    expect(s.food.y).toBe(before.food.y);
    expect(s.rng).toBe(before.rng);
    // simulation advances again after restart
    step(s, sink);
    expect(s.tick).toBe(1);
  });
});
