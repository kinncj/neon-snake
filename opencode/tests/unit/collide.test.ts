import { describe, expect, it } from "vitest";
import { applyIntent, init, makeSink, reinit, setBest, step } from "../../app/domain/step";
import { GRID_W } from "../../app/domain/types";
import { makeState, placeBody, setFood } from "./support/mut-state";

describe("wall death", () => {
  it("emits died with cause wall at the head and the head stays put", () => {
    const s = makeState({ dir: 1 });
    placeBody(s, [
      [GRID_W - 1, 5],
      [GRID_W - 2, 5],
      [GRID_W - 3, 5]
    ]);
    setFood(s, 0, 0);
    const sink = makeSink(8);
    step(s, sink);
    expect(s.phase).toBe("gameover");
    expect(sink.count).toBe(1);
    expect(sink.items[0]!.kind).toBe("died");
    expect(sink.items[0]!.cause).toBe("wall");
    expect(sink.items[0]!.x).toBe(GRID_W - 1);
    expect(sink.items[0]!.y).toBe(5);
    expect(s.body[0]!.x).toBe(GRID_W - 1); // no wrap, no move
  });
});

describe("self collision", () => {
  it("dies when moving into a body cell (cause self)", () => {
    const s = makeState({ dir: 0 }); // up
    placeBody(s, [
      [5, 5],
      [5, 4], // directly in the head's path
      [6, 4]
    ]);
    setFood(s, 0, 0);
    const sink = makeSink(8);
    step(s, sink);
    expect(s.phase).toBe("gameover");
    expect(sink.count).toBe(1);
    expect(sink.items[0]!.kind).toBe("died");
    expect(sink.items[0]!.cause).toBe("self");
    expect(sink.items[0]!.x).toBe(5);
    expect(sink.items[0]!.y).toBe(5);
  });

  it("allows moving into the tail cell (it vacates this tick)", () => {
    const s = makeState({ dir: 0 }); // up
    placeBody(s, [
      [5, 5],
      [5, 6],
      [5, 4] // tail is where the head is moving
    ]);
    setFood(s, 0, 0);
    const sink = makeSink(8);
    step(s, sink);
    expect(s.phase).toBe("playing");
    expect(s.body[0]!.x).toBe(5);
    expect(s.body[0]!.y).toBe(4);
    expect(s.bodyLen).toBe(3);
    sink.count = 0;
  });
});

describe("death bookkeeping", () => {
  it("death records the score as best when it exceeds the previous best", () => {
    const s = makeState({ dir: 1, score: 70, best: 100 });
    placeBody(s, [
      [GRID_W - 1, 5],
      [GRID_W - 2, 5],
      [GRID_W - 3, 5]
    ]);
    setFood(s, 0, 0);
    const sink = makeSink(8);
    step(s, sink);
    expect(s.best).toBe(100); // 70 < 100: unchanged
    sink.count = 0;

    const t = makeState({ dir: 1, score: 120, best: 100 });
    placeBody(t, [
      [GRID_W - 1, 5],
      [GRID_W - 2, 5],
      [GRID_W - 3, 5]
    ]);
    setFood(t, 0, 0);
    step(t, sink);
    expect(t.best).toBe(120);
    sink.count = 0;
  });
});

describe("gameover is terminal", () => {
  it("step is a no-op: same state, no effects, tick frozen", () => {
    const s = makeState({ dir: 1, phase: "gameover", tick: 42 });
    placeBody(s, [
      [GRID_W - 1, 5],
      [GRID_W - 2, 5],
      [GRID_W - 3, 5]
    ]);
    const sink = makeSink(8);
    const r = step(s, sink);
    expect(r).toBe(s);
    expect(s.tick).toBe(42);
    expect(sink.count).toBe(0);
  });

  it("ignores all intents in gameover", () => {
    const s = makeState({ phase: "gameover", score: 10 });
    applyIntent(s, { kind: "pause" });
    expect(s.phase).toBe("gameover");
    applyIntent(s, { kind: "turn", dir: 0 });
    expect(s.pendingLen).toBe(0);
  });
});

describe("pause", () => {
  it("toggles playing <-> paused via applyIntent", () => {
    const s = makeState();
    applyIntent(s, { kind: "pause" });
    expect(s.phase).toBe("paused");
    const sink = makeSink(8);
    step(s, sink); // paused: no tick, no effects
    expect(s.tick).toBe(0);
    expect(sink.count).toBe(0);
    applyIntent(s, { kind: "pause" });
    expect(s.phase).toBe("playing");
  });
});

describe("restart", () => {
  it("reinit reproduces the fresh-init state but keeps best", () => {
    const a = init("snake-0001");
    const b = init("snake-0001");
    setBest(b, 500);
    const sink = makeSink(32);
    for (let i = 0; i < 5; i++) {
      step(b, sink);
      sink.count = 0;
    }
    reinit(b, "snake-0001");
    expect(b.tick).toBe(0);
    expect(b.dir).toBe(1);
    expect(b.score).toBe(0);
    expect(b.bodyLen).toBe(3);
    expect(b.phase).toBe("playing");
    expect(b.rng).toBe(a.rng);
    expect(b.food.x).toBe(a.food.x);
    expect(b.food.y).toBe(a.food.y);
    expect(b.best).toBe(500);

    // same seed, same history -> identical trajectories
    for (let i = 0; i < 50; i++) {
      step(b, sink);
      sink.count = 0;
      step(a, sink);
      sink.count = 0;
    }
    expect(b.body[0]!.x).toBe(a.body[0]!.x);
    expect(b.body[0]!.y).toBe(a.body[0]!.y);
    expect(b.tick).toBe(a.tick);
  });
});
