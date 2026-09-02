import { describe, expect, it } from "vitest";
import { COMBO_WINDOW_TICKS, LEVEL_SCORES } from "../../app/domain/levels";
import { init, makeSink, reinit, step } from "../../app/domain/step";
import type { MutStateLike } from "./support/mut-state";

/**
 * Progression behaviour through the real step(): combo scaling, level
 * derivation + levelup effects, best tracking, death causes, and fruit kind
 * by level. Helpers mutate the state directly (tests only) to set up
 * positions the RNG would not place.
 */
type Mut = MutStateLike;

function placeFoodInFront(s: Mut): void {
  const head = s.body[0]!;
  const dx = s.dir === 1 ? 1 : s.dir === 3 ? -1 : 0;
  const dy = s.dir === 0 ? -1 : s.dir === 2 ? 1 : 0;
  s.food.x = head.x + dx;
  s.food.y = head.y + dy;
}

function lastOf(sink: ReturnType<typeof makeSink>): (typeof sink.items)[number] {
  return sink.items[sink.count - 1]!;
}

describe("combo", () => {
  it("first eat scores base value with combo 1", () => {
    const s = init("combo-a") as Mut;
    const sink = makeSink(16);
    placeFoodInFront(s);
    step(s, sink);
    expect(s.combo).toBe(1);
    expect(s.score).toBe(10);
    expect(s.lastEatTick).toBe(1);
  });

  it("eating again inside the window doubles the value (combo 2)", () => {
    const s = init("combo-b") as Mut;
    const sink = makeSink(16);
    placeFoodInFront(s);
    step(s, sink);
    placeFoodInFront(s);
    step(s, sink);
    expect(s.combo).toBe(2);
    expect(s.score).toBe(10 + 20);
  });

  it("a gap longer than the window resets combo to 1", () => {
    const s = init("combo-c") as Mut;
    const sink = makeSink(16);
    placeFoodInFront(s);
    step(s, sink); // tick 1, combo 1
    // Walk COMBO_WINDOW_TICKS + 1 extra ticks with no food in the path:
    // steer along the top wall row far from any fruit.
    s.food.x = 0;
    s.food.y = 0; // far corner, unreachable in 7 straight ticks from centre
    for (let i = 0; i < COMBO_WINDOW_TICKS + 1; i++) {
      s.dir = 1; // keep sliding right; head starts mid-field, 15 cells to wall
      step(s, sink);
      if (s.phase === "gameover") break;
    }
    expect(s.phase).toBe("playing");
    placeFoodInFront(s);
    step(s, sink);
    expect(s.combo).toBe(1);
  });
});

describe("levels and best", () => {
  it("level climbs as score crosses a threshold and emits levelup once", () => {
    const s = init("level-a") as Mut;
    const sink = makeSink(32);
    // Jump to one apple short of the level-2 threshold, then eat:
    // score 140 + (10 * combo 1) = 150 => level 2.
    s.score = 140;
    s.combo = 0;
    placeFoodInFront(s);
    step(s, sink);
    expect(s.level).toBe(2);
    expect(s.score).toBe(LEVEL_SCORES[1]);
    const levelups: number[] = [];
    for (let i = 0; i < sink.count; i++)
      if (sink.items[i]!.kind === "levelup") levelups.push(sink.items[i]!.x);
    expect(levelups).toHaveLength(1);
  });

  it("eating an orange at level 3 scores 20 * combo", () => {
    const s = init("level-b") as Mut;
    const sink = makeSink(32);
    s.level = 3;
    s.score = 400;
    placeFoodInFront(s);
    s.food.kind = "orange";
    step(s, sink);
    expect(s.score).toBe(400 + 20);
    expect(s.combo).toBe(1);
  });

  it("best tracks the max score and survives a restart", () => {
    const s = init("best-a") as Mut;
    const sink = makeSink(32);
    placeFoodInFront(s);
    step(s, sink);
    expect(s.best).toBe(10);
    reinit(s, "best-a");
    expect(s.score).toBe(0);
    expect(s.best).toBe(10); // kept
    expect(s.level).toBe(1);
    expect(s.combo).toBe(0);
  });
});

describe("death cause", () => {
  it("wall death carries cause wall", () => {
    const s = init("death-wall") as Mut;
    const sink = makeSink(16);
    s.body[0]!.x = 31;
    s.body[0]!.y = 5;
    s.body[1]!.x = 30;
    s.body[1]!.y = 5;
    s.body[2]!.x = 29;
    s.body[2]!.y = 5;
    s.dir = 1;
    step(s, sink);
    expect(s.phase).toBe("gameover");
    expect(lastOf(sink).kind).toBe("died");
    expect(lastOf(sink).cause).toBe("wall");
  });

  it("self bite carries cause self", () => {
    const s = init("death-self") as Mut;
    const sink = makeSink(16);
    // Head at (16,15) moving right; a body cell sits in front of the head.
    s.body[0]!.x = 16;
    s.body[0]!.y = 15;
    s.body[1]!.x = 17;
    s.body[1]!.y = 15;
    s.body[2]!.x = 15;
    s.body[2]!.y = 15;
    s.dir = 1;
    step(s, sink);
    expect(s.phase).toBe("gameover");
    expect(lastOf(sink).kind).toBe("died");
    expect(lastOf(sink).cause).toBe("self");
  });

  it("non-death effects carry cause none", () => {
    const s = init("cause-none") as Mut;
    const sink = makeSink(16);
    placeFoodInFront(s);
    step(s, sink);
    for (let i = 0; i < sink.count; i++) {
      const e = sink.items[i]!;
      if (e.kind === "ate") expect(e.cause).toBe("none");
    }
  });
});

describe("fruit kind follows level at spawn", () => {
  it("a spawn at level 4 is an orange", () => {
    const s = init("kind-a") as Mut;
    const sink = makeSink(32);
    s.level = 4;
    placeFoodInFront(s);
    step(s, sink);
    // The next spawn (emitted as "spawned") used level 4's kind.
    const spawn = sink.items.find((e) => e.kind === "spawned")!;
    expect(s.food.x).toBe(spawn.x);
    expect(s.food.kind).toBe("orange");
  });
});
