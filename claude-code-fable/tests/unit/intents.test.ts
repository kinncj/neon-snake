import { describe, it, expect } from "vitest";
import { enqueue, enqueueTurn } from "../../app/domain/intents";
import {
  type State, CELL_COUNT, MAX_PENDING, INTENT_PAUSE, INTENT_RESTART, turnIntent
} from "../../app/domain/types";

function blank(): State {
  return {
    seed: 1, tick: 0, dir: 0,
    pending: new Uint8Array(MAX_PENDING), pendingLen: 0,
    body: new Uint16Array(CELL_COUNT), bodyLen: 3,
    foodX: 0, foodY: 0, score: 0, phase: "playing", rng: 1,
    lastEatTick: -1, combo: 1, level: 1
  };
}

describe("intent buffering", () => {
  it("rejects a 180 degree reversal of the heading", () => {
    const s = blank(); // heading right
    expect(enqueueTurn(s, 2)).toBe(false);
    expect(s.pendingLen).toBe(0);
  });
  it("rejects a no-op turn equal to the heading", () => {
    const s = blank();
    expect(enqueueTurn(s, 0)).toBe(false);
    expect(s.pendingLen).toBe(0);
  });
  it("appends a valid turn", () => {
    const s = blank();
    expect(enqueueTurn(s, 1)).toBe(true);
    expect(s.pendingLen).toBe(1);
    expect(s.pending[0]).toBe(1);
  });
  it("uses the newest pending turn as the reference", () => {
    const s = blank();
    enqueueTurn(s, 1); // down
    expect(enqueueTurn(s, 3)).toBe(false); // up reverses the pending down
    expect(enqueueTurn(s, 1)).toBe(false); // repeat of pending
    expect(enqueueTurn(s, 2)).toBe(true); // left is a legal turn after down
    expect(Array.from(s.pending.subarray(0, s.pendingLen))).toEqual([1, 2]);
  });
  it("drops turns when the buffer is full", () => {
    const s = blank();
    expect(enqueueTurn(s, 1)).toBe(true);
    expect(enqueueTurn(s, 0)).toBe(true);
    expect(enqueueTurn(s, 3)).toBe(true);
    expect(s.pendingLen).toBe(MAX_PENDING);
    expect(enqueueTurn(s, 2)).toBe(false);
    expect(s.pendingLen).toBe(MAX_PENDING);
  });
  it("routes turn intents through the buffer", () => {
    const s = blank();
    expect(enqueue(s, turnIntent(3))).toBe(true);
    expect(s.pending[0]).toBe(3);
  });
  it("pause toggles playing and paused, never gameover", () => {
    const s = blank();
    expect(enqueue(s, INTENT_PAUSE)).toBe(true);
    expect(s.phase).toBe("paused");
    expect(enqueue(s, INTENT_PAUSE)).toBe(true);
    expect(s.phase).toBe("playing");
    s.phase = "gameover";
    expect(enqueue(s, INTENT_PAUSE)).toBe(false);
    expect(s.phase).toBe("gameover");
  });
  it("restart is not handled by the buffer", () => {
    const s = blank();
    expect(enqueue(s, INTENT_RESTART)).toBe(false);
  });
});
