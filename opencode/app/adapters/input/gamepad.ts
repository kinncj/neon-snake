// Gamepad input adapter.
//
// Polls the standard-mapping gamepad each frame (requestAnimationFrame) and
// edge-detects inputs so a held button/stick fires once, not every frame:
//   - d-pad (buttons 12 up, 15 right, 13 down, 14 left) -> turn
//   - left stick past a 0.5 deadzone, dominant axis wins -> turn
//   - face button A (0) -> restart, face button B (1) -> pause
// All intents are pushed into the shared IntentQueue, identical to the
// keyboard adapter.
//
// The per-frame decision is a pure function (gamepadFrame) over a minimal
// pad shape + the previous frame's state, so it is unit-testable with a fake
// pad and allocates nothing per frame (bitmask + stick direction).

import type { Dir, Intent } from "../../domain/types";
import type { IntentQueue } from "./queue";

const DEADZONE = 0.5;

// Bitmask bits for the relevant buttons.
const BIT_A = 1 << 0; // button 0 -> restart
const BIT_B = 1 << 1; // button 1 -> pause
const BIT_UP = 1 << 2; // button 12 -> turn up
const BIT_RIGHT = 1 << 3; // button 15 -> turn right
const BIT_DOWN = 1 << 4; // button 13 -> turn down
const BIT_LEFT = 1 << 5; // button 14 -> turn left

/** Minimal pad shape the adapter reads (a real Gamepad satisfies it). */
export interface PadLike {
  buttons: ReadonlyArray<{ pressed: boolean }>;
  axes: ReadonlyArray<number>;
}

/** State carried between frames (primitives only: no allocation). */
export interface PadFrame {
  mask: number;
  stick: number; // -1 = centred, otherwise a Dir
}

/** Dominant-axis stick direction past the deadzone, or null if centred. */
export function stickDirection(x: number, y: number): Dir | null {
  if (Math.abs(x) <= DEADZONE && Math.abs(y) <= DEADZONE) return null;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 1 : 3;
  return y > 0 ? 2 : 0;
}

function buttonMask(pad: PadLike): number {
  let mask = 0;
  if (pad.buttons[0]?.pressed) mask |= BIT_A;
  if (pad.buttons[1]?.pressed) mask |= BIT_B;
  if (pad.buttons[12]?.pressed) mask |= BIT_UP;
  if (pad.buttons[13]?.pressed) mask |= BIT_DOWN;
  if (pad.buttons[14]?.pressed) mask |= BIT_LEFT;
  if (pad.buttons[15]?.pressed) mask |= BIT_RIGHT;
  return mask;
}

function snapshot(pad: PadLike): PadFrame {
  const sd = stickDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
  return { mask: buttonMask(pad), stick: sd === null ? -1 : sd };
}

/** Pure: edge-detect the intents raised between `prev` and `pad`. */
export function gamepadFrame(prev: PadFrame | null, pad: PadLike): Intent[] {
  const out: Intent[] = [];
  if (prev === null) return out; // first frame: require a fresh press
  const cur = snapshot(pad);
  const rose = (bit: number): boolean =>
    (cur.mask & bit) !== 0 && (prev.mask & bit) === 0;
  if (rose(BIT_UP)) out.push({ kind: "turn", dir: 0 });
  if (rose(BIT_RIGHT)) out.push({ kind: "turn", dir: 1 });
  if (rose(BIT_DOWN)) out.push({ kind: "turn", dir: 2 });
  if (rose(BIT_LEFT)) out.push({ kind: "turn", dir: 3 });
  if (rose(BIT_A)) out.push({ kind: "restart" });
  if (rose(BIT_B)) out.push({ kind: "pause" });
  if (cur.stick !== -1 && cur.stick !== prev.stick) {
    out.push({ kind: "turn", dir: cur.stick as Dir });
  }
  return out;
}

/** Attach the gamepad poller to the shared queue; returns a detach fn. */
export function attachGamepad(queue: IntentQueue): () => void {
  let raf = 0;
  let prev: PadFrame | null = null;
  const poll = (): void => {
    const pads = navigator.getGamepads();
    let pad: PadLike | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p != null && p.connected) {
        pad = p;
        break;
      }
    }
    if (pad !== null) {
      for (const intent of gamepadFrame(prev, pad)) queue.push(intent);
      prev = snapshot(pad);
    } else {
      prev = null;
    }
    raf = requestAnimationFrame(poll);
  };
  raf = requestAnimationFrame(poll);
  return () => cancelAnimationFrame(raf);
}
