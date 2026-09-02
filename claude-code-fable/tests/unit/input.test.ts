import { describe, it, expect } from "vitest";
import { createIntentQueue } from "../../app/adapters/input/queue";
import { mapKey } from "../../app/adapters/input/keyboard";
import {
  readLogical, edgeIntents, LOGICAL_COUNT, BTN_DPAD_LEFT, BTN_START, BTN_B, STICK_DEADZONE
} from "../../app/adapters/input/gamepad";
import { INTENT_PAUSE, INTENT_RESTART } from "../../app/domain/types";

describe("intent queue", () => {
  it("is FIFO and drops on overflow", () => {
    const q = createIntentQueue(3);
    expect(q.push(1)).toBe(true);
    expect(q.push(2)).toBe(true);
    expect(q.push(3)).toBe(true);
    expect(q.push(4)).toBe(false);
    expect(q.size()).toBe(3);
    expect(q.shift()).toBe(1);
    expect(q.shift()).toBe(2);
    expect(q.push(5)).toBe(true);
    expect(q.shift()).toBe(3);
    expect(q.shift()).toBe(5);
    expect(q.shift()).toBe(-1);
  });
  it("clear empties it", () => {
    const q = createIntentQueue();
    q.push(4);
    q.clear();
    expect(q.size()).toBe(0);
    expect(q.shift()).toBe(-1);
  });
});

describe("keyboard mapping", () => {
  it("arrows and WASD turn", () => {
    expect(mapKey("ArrowUp")).toBe(3);
    expect(mapKey("KeyW")).toBe(3);
    expect(mapKey("ArrowDown")).toBe(1);
    expect(mapKey("KeyS")).toBe(1);
    expect(mapKey("ArrowLeft")).toBe(2);
    expect(mapKey("KeyA")).toBe(2);
    expect(mapKey("ArrowRight")).toBe(0);
    expect(mapKey("KeyD")).toBe(0);
  });
  it("P and Escape pause, R restarts, others unbound", () => {
    expect(mapKey("KeyP")).toBe(INTENT_PAUSE);
    expect(mapKey("Escape")).toBe(INTENT_PAUSE);
    expect(mapKey("KeyR")).toBe(INTENT_RESTART);
    expect(mapKey("KeyQ")).toBe(-1);
    expect(mapKey("Space")).toBe(-1);
  });
});

describe("gamepad mapping", () => {
  const buttons = (...on: number[]) => {
    const b = new Array<boolean>(16).fill(false);
    for (const i of on) b[i] = true;
    return b;
  };
  it("d-pad, stick past the deadzone and menu buttons fold into intents", () => {
    const out = new Uint8Array(LOGICAL_COUNT);
    readLogical(buttons(BTN_DPAD_LEFT), [0, 0], out);
    expect(Array.from(out)).toEqual([0, 0, 1, 0, 0, 0]);
    readLogical(buttons(), [0, -0.9], out);
    expect(Array.from(out)).toEqual([1, 0, 0, 0, 0, 0]);
    readLogical(buttons(), [STICK_DEADZONE - 0.01, 0], out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 0]);
    readLogical(buttons(BTN_START), [0, 0], out);
    expect(out[4]).toBe(1);
    readLogical(buttons(BTN_B), [0, 0], out);
    expect(out[5]).toBe(1);
  });
  it("emits one intent per rising edge", () => {
    const q = createIntentQueue();
    const prev = new Uint8Array(LOGICAL_COUNT);
    const now = new Uint8Array(LOGICAL_COUNT);
    readLogical(buttons(BTN_DPAD_LEFT), [0, 0], now);
    expect(edgeIntents(now, prev, q)).toBe(1);
    expect(q.shift()).toBe(2);
    expect(edgeIntents(now, prev, q)).toBe(0); // held
    readLogical(buttons(), [0, 0], now);
    expect(edgeIntents(now, prev, q)).toBe(0); // released
    readLogical(buttons(BTN_DPAD_LEFT, BTN_START), [0, 0], now);
    expect(edgeIntents(now, prev, q)).toBe(2);
    expect([q.shift(), q.shift()]).toEqual([2, INTENT_PAUSE]);
  });
});

describe("swipe recogniser", () => {
  it("fires once per gesture on the dominant axis past the threshold", async () => {
    const { createSwipe, SWIPE_PX } = await import("../../app/adapters/input/touch");
    const s = createSwipe();
    s.begin(100, 100);
    expect(s.move(100 + SWIPE_PX - 1, 100)).toBe(-1);
    expect(s.move(100 + SWIPE_PX, 105)).toBe(0); // right
    expect(s.move(100 + SWIPE_PX * 3, 100)).toBe(-1); // already fired
    s.end();
    s.begin(0, 0);
    expect(s.move(-10, 40)).toBe(1); // down beats a small leftward drift
    s.end();
    s.begin(0, 0);
    expect(s.move(-30, -29)).toBe(2); // ties go to the horizontal axis
    s.end();
    s.begin(0, 0);
    expect(s.move(3, -30)).toBe(3); // up
    expect(s.active()).toBe(true);
    s.end();
    expect(s.active()).toBe(false);
    expect(s.move(50, 50)).toBe(-1); // no gesture in progress
  });
});
