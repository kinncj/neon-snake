import { describe, expect, it } from "vitest";
import { enqueue } from "../../app/domain/intents";
import type { Dir } from "../../app/domain/types";
import { makeState } from "./support/mut-state";

const turn = (dir: Dir) => ({ kind: "turn" as const, dir });
const OPPOSITE: readonly Dir[] = [2, 3, 0, 1];

describe("enqueue", () => {
  it("appends a valid turn when the buffer is empty (reference = dir)", () => {
    const s = makeState({ dir: 1 });
    expect(enqueue(s, turn(2)).pendingLen).toBe(1);
    expect(s.pending[0]).toBe(2);
  });

  it("rejects a no-op turn (equals dir) when the buffer is empty", () => {
    const s = makeState({ dir: 1 });
    enqueue(s, turn(1));
    expect(s.pendingLen).toBe(0);
  });

  it("rejects the 180° opposite of dir when the buffer is empty", () => {
    for (const d of [0, 1, 2, 3] as const) {
      const s = makeState({ dir: d });
      enqueue(s, turn(OPPOSITE[d]!));
      expect(s.pendingLen).toBe(0);
    }
  });

  it("uses the last pending entry as the reference once the buffer is non-empty", () => {
    const s = makeState({ dir: 1 });
    enqueue(s, turn(2)); // buffer: [down]
    // opposite of down is up: rejected against the queued entry even
    // though up would be legal against dir=right
    enqueue(s, turn(0));
    expect(s.pendingLen).toBe(1);
    // a legal second entry: down then left
    enqueue(s, turn(3));
    expect(s.pendingLen).toBe(2);
    expect(s.pending[1]).toBe(3);
  });

  it("drops a turn when the buffer is full", () => {
    const s = makeState({ dir: 1 });
    enqueue(s, turn(2));
    enqueue(s, turn(3));
    enqueue(s, turn(0)); // full: dropped, buffer untouched
    expect(s.pendingLen).toBe(2);
    expect(s.pending[0]).toBe(2);
    expect(s.pending[1]).toBe(3);
  });

  it("allows a U-turn spread over two buffered ticks (right -> up -> left)", () => {
    const s = makeState({ dir: 1 });
    enqueue(s, turn(0));
    enqueue(s, turn(3));
    expect(s.pendingLen).toBe(2);
    expect(s.pending[0]).toBe(0);
    expect(s.pending[1]).toBe(3);
  });

  it("does not buffer pause or restart", () => {
    const s = makeState();
    enqueue(s, { kind: "pause" });
    enqueue(s, { kind: "restart" });
    expect(s.pendingLen).toBe(0);
    expect(s.phase).toBe("playing");
  });

  it("mutates in place and returns the same reference", () => {
    const s = makeState();
    expect(enqueue(s, turn(2))).toBe(s);
  });
});
