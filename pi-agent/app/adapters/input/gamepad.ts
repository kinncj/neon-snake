import type { Dir, Intent } from "../../domain/types";
import { IntentQueue } from "./keyboard";

/**
 * Gamepad adapter. Standard mapping (index per the W3C gamepad spec):
 *   d-pad:   12=up 13=left 14=right 15=down      -> turn
 *   faces:   3(Y)=up 2(X)=left 1(B)=right 0(A)=down -> turn
 *   start(7) -> pause, back(6) -> restart
 *   left stick past a 0.5 deadzone, dominant axis wins -> turn
 * All triggers are edge-based: a direction fires once when it becomes
 * active, not on every polled frame.
 */
export const STICK_DEADZONE = 0.5;

export interface PadSnapshot {
  readonly connected: boolean;
  readonly buttons: ArrayLike<{ readonly pressed: boolean }>;
  readonly axes: ArrayLike<number>;
}

interface PadState {
  prevButtons: boolean[];
  prevStickDir: Dir | null;
}

export function makePadState(): PadState {
  return { prevButtons: new Array(20).fill(false), prevStickDir: null };
}

/** Stick -> dir when past the deadzone, dominant axis wins. */
export function stickToDir(x: number, y: number): Dir | null {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax <= STICK_DEADZONE && ay <= STICK_DEADZONE) return null;
  if (ax >= ay) return x > 0 ? 1 : 3;
  return y > 0 ? 2 : 0;
}

const BUTTON_DIRS: ReadonlyArray<readonly [number, Dir]> = [
  [12, 0], // d-pad up
  [13, 3], // d-pad left
  [14, 1], // d-pad right
  [15, 2], // d-pad down
  [3, 0], // Y face: up
  [2, 3], // X face: left
  [1, 1], // B face: right
  [0, 2] // A face: down
];

/**
 * Poll a snapshot against the previous state and push edge-triggered intents
 * into the queue. Pure with respect to the DOM: takes data, returns nothing.
 */
export function pollPad(state: PadState, snap: PadSnapshot, queue: IntentQueue): void {
  if (!snap.connected) return;

  // Button edges (d-pad + faces)
  for (const [idx, dir] of BUTTON_DIRS) {
    const now = snap.buttons[idx] !== undefined && snap.buttons[idx]!.pressed;
    const prev = state.prevButtons[idx] ?? false;
    if (now && !prev) queue.push("turn", dir);
  }
  const startNow = snap.buttons[7] !== undefined && snap.buttons[7]!.pressed;
  const backNow = snap.buttons[6] !== undefined && snap.buttons[6]!.pressed;
  if (startNow && !(state.prevButtons[7] ?? false)) queue.push("pause");
  if (backNow && !(state.prevButtons[6] ?? false)) queue.push("restart");
  for (let i = 0; i < state.prevButtons.length; i++) {
    state.prevButtons[i] = snap.buttons[i] !== undefined && snap.buttons[i]!.pressed;
  }

  // Stick edge
  const dir = stickToDir(snap.axes[0] ?? 0, snap.axes[1] ?? 0);
  if (dir !== null && dir !== state.prevStickDir) queue.push("turn", dir);
  state.prevStickDir = dir;
}

/**
 * Poll navigator.getGamepads() on requestAnimationFrame and push
 * edge-triggered intents into the shared queue. Returns a detach function.
 */
export function attachGamepad(queue: IntentQueue): () => void {
  const state = makePadState();
  let raf = 0;
  const frame = (): void => {
    const pads = navigator.getGamepads();
    let snap: PadSnapshot | null = null;
    if (pads) {
      for (const p of pads) {
        if (p !== null && p.connected) {
          snap = { connected: true, buttons: p.buttons, axes: p.axes };
          break;
        }
      }
    }
    if (snap === null) {
      pollPad(state, { connected: false, buttons: EMPTY_BUTTONS, axes: EMPTY }, queue);
    } else {
      pollPad(state, snap, queue);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
  };
}

const EMPTY: ArrayLike<number> = [];
const EMPTY_BUTTONS: ArrayLike<{ readonly pressed: boolean }> = [];

/** A turn intent as emitted by the pad; shared shape with the keyboard. */
export function padTurnIntent(dir: Dir): Intent {
  return { kind: "turn", dir };
}
