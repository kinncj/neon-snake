import { describe, expect, it } from "vitest";
import { keyToIntent, IntentQueue } from "../../app/adapters/input/keyboard";
import { makePadState, padTurnIntent, pollPad, stickToDir } from "../../app/adapters/input/gamepad";
import type { PadSnapshot } from "../../app/adapters/input/gamepad";

function snap(buttons: number[], axes: [number, number], connected = true): PadSnapshot {
  const arr: { pressed: boolean }[] = [];
  for (let i = 0; i < 18; i++) arr.push({ pressed: buttons.includes(i) });
  return { connected, buttons: arr, axes };
}

describe("keyToIntent", () => {
  it("maps arrows and WASD to turn intents", () => {
    expect(keyToIntent("ArrowUp")).toEqual({ intent: { kind: "turn", dir: 0 }, prevent: true });
    expect(keyToIntent("KeyW")).toEqual({ intent: { kind: "turn", dir: 0 }, prevent: true });
    expect(keyToIntent("ArrowRight")).toEqual({ intent: { kind: "turn", dir: 1 }, prevent: true });
    expect(keyToIntent("KeyD")).toEqual({ intent: { kind: "turn", dir: 1 }, prevent: true });
    expect(keyToIntent("ArrowDown")).toEqual({ intent: { kind: "turn", dir: 2 }, prevent: true });
    expect(keyToIntent("KeyS")).toEqual({ intent: { kind: "turn", dir: 2 }, prevent: true });
    expect(keyToIntent("ArrowLeft")).toEqual({ intent: { kind: "turn", dir: 3 }, prevent: true });
    expect(keyToIntent("KeyA")).toEqual({ intent: { kind: "turn", dir: 3 }, prevent: true });
  });

  it("maps P and Escape to pause, R to restart", () => {
    expect(keyToIntent("KeyP").intent).toEqual({ kind: "pause" });
    expect(keyToIntent("Escape").intent).toEqual({ kind: "pause" });
    expect(keyToIntent("KeyR").intent).toEqual({ kind: "restart" });
  });

  it("prevents default on arrows and space, not on others", () => {
    expect(keyToIntent("ArrowUp").prevent).toBe(true);
    expect(keyToIntent("Space").prevent).toBe(true);
    expect(keyToIntent("Space").intent).toBeNull();
    expect(keyToIntent("KeyP").prevent).toBe(false);
    expect(keyToIntent("KeyR").prevent).toBe(false);
  });

  it("ignores unrelated keys", () => {
    expect(keyToIntent("KeyX").intent).toBeNull();
    expect(keyToIntent("Enter").prevent).toBe(false);
  });
});

describe("stickToDir", () => {
  it("returns null inside the deadzone", () => {
    expect(stickToDir(0, 0)).toBeNull();
    expect(stickToDir(0.5, 0)).toBeNull();
    expect(stickToDir(0, 0.5)).toBeNull();
    expect(stickToDir(0.4, 0.4)).toBeNull();
  });

  it("dominant axis wins past the deadzone", () => {
    expect(stickToDir(0.9, 0.2)).toBe(1); // right
    expect(stickToDir(-0.9, 0.2)).toBe(3); // left
    expect(stickToDir(0.2, 0.9)).toBe(2); // down
    expect(stickToDir(0.2, -0.9)).toBe(0); // up
  });
});

describe("gamepad polling (edge-triggered)", () => {
  it("d-pad and face buttons emit a single turn on press", () => {
    const q = new IntentQueue();
    const st = makePadState();
    pollPad(st, snap([12], [0, 0]), q); // d-pad up
    expect(q.pop()).toEqual({ kind: "turn", dir: 0 });
    // held: no re-trigger
    pollPad(st, snap([12], [0, 0]), q);
    expect(q.length).toBe(0);
    // release
    pollPad(st, snap([], [0, 0]), q);
    expect(q.length).toBe(0);
    // face up (Y=3)
    pollPad(st, snap([3], [0, 0]), q);
    expect(q.pop()).toEqual({ kind: "turn", dir: 0 });
  });

  it("start and back map to pause and restart", () => {
    const q = new IntentQueue();
    const st = makePadState();
    pollPad(st, snap([7], [0, 0]), q);
    expect(q.pop()).toEqual({ kind: "pause" });
    pollPad(st, snap([6], [0, 0]), q);
    expect(q.pop()).toEqual({ kind: "restart" });
  });

  it("stick emits a turn only on the edge past the deadzone", () => {
    const q = new IntentQueue();
    const st = makePadState();
    pollPad(st, snap([], [0.8, 0]), q);
    expect(q.pop()).toEqual({ kind: "turn", dir: 1 });
    // held same direction: no re-trigger
    pollPad(st, snap([], [0.8, 0]), q);
    expect(q.length).toBe(0);
  });

  it("a gamepad 'up' is shape-identical to a keyboard 'up'", () => {
    const kb = keyToIntent("ArrowUp").intent!;
    const q = new IntentQueue();
    const st = makePadState();
    pollPad(st, snap([12], [0, 0]), q);
    const gp = q.pop()!;
    expect(gp).toEqual(kb);
    expect(Object.keys(gp).sort()).toEqual(Object.keys(kb).sort());
    expect(gp).toEqual(padTurnIntent(0));
  });
});

describe("IntentQueue", () => {
  it("FIFO ordering and clear", () => {
    const q = new IntentQueue();
    q.push("turn", 0);
    q.push("pause");
    expect(q.pop()).toEqual({ kind: "turn", dir: 0 });
    expect(q.pop()).toEqual({ kind: "pause" });
    expect(q.pop()).toBeNull();
    q.clear();
    expect(q.length).toBe(0);
  });

  it("overflow drops the oldest, never grows", () => {
    const q = new IntentQueue(4);
    for (let d = 0; d < 6; d++) q.push("turn", (d % 4) as 0 | 1 | 2 | 3);
    expect(q.length).toBe(4);
    const out: number[] = [];
    let it = q.pop();
    while (it !== null) {
      if (it.kind === "turn") out.push(it.dir);
      it = q.pop();
    }
    // oldest (0,1) dropped; remaining in order 2,3,0,1
    expect(out).toEqual([2, 3, 0, 1]);
  });
});
