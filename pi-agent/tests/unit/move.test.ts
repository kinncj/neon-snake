import { describe, expect, it } from "vitest";
import { GRID_H, GRID_W, MAX_PENDING } from "../../app/domain/types";
import { applyIntent, init, makeSink, step } from "../../app/domain/step";

const SEED = "move-test-01";

function cells(state: ReturnType<typeof init>): [number, number][] {
  return state.body.map((c) => [c.x, c.y] as [number, number]);
}

describe("init", () => {
  it("preallocates fixed-capacity arrays", () => {
    const s = init(SEED);
    expect(s.body.length).toBe(GRID_W * GRID_H);
    expect(s.pending.length).toBe(MAX_PENDING);
    expect(s.bodyLen).toBe(3);
    expect(s.pendingLen).toBe(0);
    expect(s.tick).toBe(0);
    expect(s.phase).toBe("playing");
    expect(s.rng).toBe(3156223106); // recorded for seed "move-test-01"
  });

  it("places head at grid centre facing right with a trailing body", () => {
    const s = init(SEED);
    const b = cells(s);
    expect(b[0]).toEqual([16, 15]);
    expect(b[1]).toEqual([15, 15]);
    expect(b[2]).toEqual([14, 15]);
  });

  it("is deterministic for the same seed", () => {
    const a = init(SEED);
    const b = init(SEED);
    expect(a.food.x).toBe(b.food.x);
    expect(a.food.y).toBe(b.food.y);
    expect(a.rng).toBe(b.rng);
  });
});

describe("step: movement", () => {
  it("10 ticks from a known init produce the known body", () => {
    const s = init(SEED);
    const sink = makeSink(16);
    // recorded: init places food at (2,12), off the straight path
    expect([s.food.x, s.food.y]).toEqual([2, 12]);
    for (let i = 0; i < 10; i++) step(s, sink);
    expect(s.tick).toBe(10);
    expect(s.phase).toBe("playing");
    expect(s.score).toBe(0);
    expect(s.bodyLen).toBe(3);
    expect(cells(s).slice(0, 3)).toEqual([
      [26, 15],
      [25, 15],
      [24, 15]
    ]);
    // all unused slots stay zeroed
    expect(cells(s).slice(3, 10).every((c) => c[0] === 0 && c[1] === 0)).toBe(true);
  });

  it("shifts body cells in place without growing", () => {
    const s = init(SEED);
    const sink = makeSink(16);
    step(s, sink);
    expect(cells(s).slice(0, 3)).toEqual([
      [17, 15],
      [16, 15],
      [15, 15]
    ]);
  });

  it("consumes a queued turn at the start of the tick and emits turned", () => {
    const s = init(SEED);
    applyIntent(s, { kind: "turn", dir: 2 }); // down
    const sink = makeSink(16);
    sink.count = 0;
    step(s, sink);
    expect(s.dir).toBe(2);
    expect(s.pendingLen).toBe(0);
    const head = s.body[0]!;
    expect([head.x, head.y]).toEqual([16, 16]);
    expect(sink.count).toBe(1);
    expect(sink.items[0]).toMatchObject({ kind: "turned", x: 16, y: 15 });
  });

  it("applies two buffered turns one per tick", () => {
    const s = init(SEED);
    applyIntent(s, { kind: "turn", dir: 2 });
    applyIntent(s, { kind: "turn", dir: 3 });
    const sink = makeSink(16);
    step(s, sink);
    expect(s.dir).toBe(2);
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([16, 16]);
    sink.count = 0;
    step(s, sink);
    expect(s.dir).toBe(3);
    expect([s.body[0]!.x, s.body[0]!.y]).toEqual([15, 16]);
  });
});
