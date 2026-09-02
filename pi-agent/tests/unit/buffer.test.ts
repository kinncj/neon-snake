import { describe, expect, it } from "vitest";
import { GRID_H, GRID_W, MAX_PENDING } from "../../app/domain/types";
import type { Dir, State } from "../../app/domain/types";
import { enqueue } from "../../app/domain/intents";

function mkState(dir: Dir, pendingLen = 0, pending: Dir[] = []): State {
  const body: { readonly x: number; readonly y: number }[] = [];
  for (let i = 0; i < GRID_W * GRID_H; i++) body.push({ x: 0, y: 0 });
  const p: Dir[] = [1, 1];
  for (let i = 0; i < pendingLen; i++) p[i] = pending[i]!;
  return {
    tick: 0,
    dir,
    pendingLen,
    pending: p,
    bodyLen: 3,
    body,
    food: { x: 8, y: 8, kind: "apple" },
    score: 0,
    level: 1,
    combo: 0,
    lastEatTick: 0,
    best: 0,
    phase: "playing",
    rng: 12345
  };
}

describe("enqueue", () => {
  it("queues up then left while moving right", () => {
    let s = mkState(1);
    s = enqueue(s, { kind: "turn", dir: 0 });
    expect(s.pendingLen).toBe(1);
    s = enqueue(s, { kind: "turn", dir: 3 });
    expect(s.pendingLen).toBe(2);
    expect(s.pending[0]).toBe(0);
    expect(s.pending[1]).toBe(3);
  });

  it("rejects the 180 opposite", () => {
    const s = mkState(1); // moving right
    expect(enqueue(s, { kind: "turn", dir: 3 })).toBe(s);
    expect(s.pendingLen).toBe(0);
  });

  it("rejects a no-op turn", () => {
    const s = mkState(1); // moving right
    expect(enqueue(s, { kind: "turn", dir: 1 })).toBe(s);
    expect(s.pendingLen).toBe(0);
  });

  it("rejects the opposite of the last pending entry", () => {
    let s = mkState(1);
    s = enqueue(s, { kind: "turn", dir: 0 }); // up queued, ref is now up
    expect(enqueue(s, { kind: "turn", dir: 2 })).toBe(s); // down rejected
    expect(s.pendingLen).toBe(1);
  });

  it("drops a third turn when the queue is full", () => {
    let s = mkState(1);
    s = enqueue(s, { kind: "turn", dir: 0 });
    s = enqueue(s, { kind: "turn", dir: 3 });
    expect(s.pendingLen).toBe(MAX_PENDING);
    expect(enqueue(s, { kind: "turn", dir: 2 })).toBe(s);
    expect(s.pendingLen).toBe(MAX_PENDING);
    expect(s.pending[1]).toBe(3); // original entry preserved
  });

  it("ignores pause and restart intents (consumed by the tick loop)", () => {
    const s = mkState(1);
    expect(enqueue(s, { kind: "pause" })).toBe(s);
    expect(enqueue(s, { kind: "restart" })).toBe(s);
    expect(s.pendingLen).toBe(0);
  });
});
