import { describe, expect, it } from "vitest";
import {
  gamepadFrame,
  stickDirection,
  type PadFrame,
  type PadLike
} from "../../app/adapters/input/gamepad";
import { keyIntent, shouldPreventDefault } from "../../app/adapters/input/keyboard";
import { IntentQueue } from "../../app/adapters/input/queue";
import { swipeDir } from "../../app/adapters/input/touch";
import type { Intent } from "../../app/domain/types";

// ---- IntentQueue -------------------------------------------------------

describe("IntentQueue", () => {
  it("drains FIFO in the order pushed", () => {
    const q = new IntentQueue(4);
    const a: Intent = { kind: "turn", dir: 0 };
    const b: Intent = { kind: "turn", dir: 1 };
    const c: Intent = { kind: "pause" };
    q.push(a);
    q.push(b);
    q.push(c);
    expect(q.size).toBe(3);
    const out: Intent[] = new Array(8);
    const n = q.drain(8, out);
    expect(n).toBe(3);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
    expect(out[2]).toBe(c);
    expect(q.size).toBe(0);
  });

  it("drains at most `max` at a time", () => {
    const q = new IntentQueue(4);
    for (let i = 0; i < 4; i++) q.push({ kind: "turn", dir: 1 });
    const out: Intent[] = new Array(8);
    expect(q.drain(2, out)).toBe(2);
    expect(q.size).toBe(2);
    expect(q.drain(2, out)).toBe(2);
    expect(q.size).toBe(0);
  });

  it("wraps around the ring after capacity pushes", () => {
    const q = new IntentQueue(2);
    const mk = (d: 0 | 1 | 2 | 3): Intent => ({ kind: "turn", dir: d });
    q.push(mk(0));
    q.push(mk(1));
    q.push(mk(2)); // full: drops the oldest (dir 0)
    expect(q.size).toBe(2);
    const out: Intent[] = new Array(4);
    q.drain(4, out);
    expect(out[0]).toEqual({ kind: "turn", dir: 1 });
    expect(out[1]).toEqual({ kind: "turn", dir: 2 });
  });

  it("drops the oldest (newest input wins) when full", () => {
    const q = new IntentQueue(2);
    const mk = (d: 0 | 1 | 2 | 3): Intent => ({ kind: "turn", dir: d });
    q.push(mk(0));
    q.push(mk(1));
    q.push(mk(2));
    q.push(mk(3));
    const out: Intent[] = new Array(4);
    q.drain(4, out);
    expect(out[0]).toEqual({ kind: "turn", dir: 2 });
    expect(out[1]).toEqual({ kind: "turn", dir: 3 });
    expect(q.size).toBe(0);
  });

  it("clear empties the queue", () => {
    const q = new IntentQueue(4);
    q.push({ kind: "pause" });
    q.push({ kind: "restart" });
    q.clear();
    expect(q.size).toBe(0);
    const out: Intent[] = new Array(4);
    expect(q.drain(4, out)).toBe(0);
  });
});

// ---- keyboard mapping --------------------------------------------------

describe("keyIntent", () => {
  it("maps arrows and WASD to turn intents", () => {
    expect(keyIntent("ArrowUp")).toEqual({ kind: "turn", dir: 0 });
    expect(keyIntent("KeyW")).toEqual({ kind: "turn", dir: 0 });
    expect(keyIntent("ArrowRight")).toEqual({ kind: "turn", dir: 1 });
    expect(keyIntent("KeyD")).toEqual({ kind: "turn", dir: 1 });
    expect(keyIntent("ArrowDown")).toEqual({ kind: "turn", dir: 2 });
    expect(keyIntent("KeyS")).toEqual({ kind: "turn", dir: 2 });
    expect(keyIntent("ArrowLeft")).toEqual({ kind: "turn", dir: 3 });
    expect(keyIntent("KeyA")).toEqual({ kind: "turn", dir: 3 });
  });

  it("maps P and Escape to pause, R to restart", () => {
    expect(keyIntent("KeyP")).toEqual({ kind: "pause" });
    expect(keyIntent("Escape")).toEqual({ kind: "pause" });
    expect(keyIntent("KeyR")).toEqual({ kind: "restart" });
  });

  it("returns null for non-game keys", () => {
    expect(keyIntent("KeyX")).toBeNull();
    expect(keyIntent("Space")).toBeNull();
    expect(keyIntent("Digit1")).toBeNull();
  });

  it("suppresses default for arrows and space only", () => {
    for (const code of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space"
    ]) {
      expect(shouldPreventDefault(code)).toBe(true);
    }
    expect(shouldPreventDefault("KeyP")).toBe(false);
    expect(shouldPreventDefault("KeyR")).toBe(false);
  });
});

// ---- gamepad mapping ---------------------------------------------------

function pad(opts: {
  buttons?: Record<number, boolean>;
  axes?: [number, number];
} = {}): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: opts.buttons?.[i] ?? false
  }));
  const axes = opts.axes ?? [0, 0];
  return { buttons, axes };
}

describe("stickDirection", () => {
  it("is null inside the deadzone", () => {
    expect(stickDirection(0, 0)).toBeNull();
    expect(stickDirection(0.4, 0.4)).toBeNull();
    expect(stickDirection(-0.5, 0)).toBeNull();
  });

  it("reports the dominant axis past the deadzone", () => {
    expect(stickDirection(0.6, 0)).toBe(1);
    expect(stickDirection(-0.9, 0)).toBe(3);
    expect(stickDirection(0, 0.6)).toBe(2);
    expect(stickDirection(0, -1)).toBe(0);
    // dominant axis wins: x is larger than y
    expect(stickDirection(0.9, 0.6)).toBe(1);
    expect(stickDirection(0.6, 0.9)).toBe(2);
  });
});

describe("gamepadFrame (edge detection)", () => {
  it("returns nothing on the first frame (no phantom inputs)", () => {
    expect(gamepadFrame(null, pad({ buttons: { 12: true } }))).toEqual([]);
  });

  it("fires a d-pad turn once on press, not while held", () => {
    const f0: PadFrame = { mask: 0, stick: -1 };
    const pressed = pad({ buttons: { 12: true } }); // up
    expect(gamepadFrame(f0, pressed)).toEqual([{ kind: "turn", dir: 0 }]);
    // held: no new intent
    const f1: PadFrame = { mask: 1 << 2, stick: -1 };
    expect(gamepadFrame(f1, pressed)).toEqual([]);
  });

  it("fires again after a full release", () => {
    const fHeld: PadFrame = { mask: 1 << 2, stick: -1 };
    const released = pad({});
    expect(gamepadFrame(fHeld, released)).toEqual([]);
    const fReleased: PadFrame = { mask: 0, stick: -1 };
    const pressed = pad({ buttons: { 12: true } });
    expect(gamepadFrame(fReleased, pressed)).toEqual([{ kind: "turn", dir: 0 }]);
  });

  it("maps face buttons A->restart and B->pause on press", () => {
    const f0: PadFrame = { mask: 0, stick: -1 };
    expect(gamepadFrame(f0, pad({ buttons: { 0: true } }))).toEqual([
      { kind: "restart" }
    ]);
    expect(gamepadFrame(f0, pad({ buttons: { 1: true } }))).toEqual([
      { kind: "pause" }
    ]);
  });

  it("fires a stick turn on entry past the deadzone", () => {
    const f0: PadFrame = { mask: 0, stick: -1 };
    expect(gamepadFrame(f0, pad({ axes: [0.8, 0] }))).toEqual([
      { kind: "turn", dir: 1 }
    ]);
  });

  it("does not re-fire a held stick, and fires on direction change", () => {
    const fRight: PadFrame = { mask: 0, stick: 1 };
    expect(gamepadFrame(fRight, pad({ axes: [0.9, 0] }))).toEqual([]);
    const fUp: PadFrame = { mask: 0, stick: 0 };
    expect(gamepadFrame(fUp, pad({ axes: [0, 0.9] }))).toEqual([
      { kind: "turn", dir: 2 }
    ]);
  });

  it("does not fire a stick turn from inside the deadzone", () => {
    const f0: PadFrame = { mask: 0, stick: -1 };
    expect(gamepadFrame(f0, pad({ axes: [0.3, 0.2] }))).toEqual([]);
  });
});

describe("swipeDir", () => {
  it("emits nothing below the 24px minimum on both axes", () => {
    expect(swipeDir(0, 0)).toBeNull();
    expect(swipeDir(23, 23)).toBeNull();
    expect(swipeDir(-23, 0)).toBeNull();
    expect(swipeDir(0, -23)).toBeNull();
  });

  it("registers a direction at exactly the 24px minimum", () => {
    expect(swipeDir(24, 0)).toBe(1);
    expect(swipeDir(-24, 0)).toBe(3);
    expect(swipeDir(0, 24)).toBe(2);
    expect(swipeDir(0, -24)).toBe(0);
  });

  it("the dominant axis wins when only it clears the minimum", () => {
    // horizontal clears, vertical is noise
    expect(swipeDir(40, 5)).toBe(1);
    expect(swipeDir(-40, -5)).toBe(3);
    // vertical clears, horizontal is noise
    expect(swipeDir(5, 40)).toBe(2);
    expect(swipeDir(-5, -40)).toBe(0);
  });

  it("horizontal axis wins a tie", () => {
    expect(swipeDir(30, 30)).toBe(1);
    expect(swipeDir(-30, 30)).toBe(3);
    expect(swipeDir(30, -30)).toBe(1);
    expect(swipeDir(-30, -30)).toBe(3);
  });
});
