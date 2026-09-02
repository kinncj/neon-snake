import { type Intent, DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, INTENT_PAUSE, INTENT_RESTART, turnIntent } from "../../domain/types";
import type { IntentQueue } from "./queue";

/** Standard-mapping button indices. */
export const BTN_A = 0;
export const BTN_B = 1;
export const BTN_SELECT = 8;
export const BTN_START = 9;
export const BTN_DPAD_UP = 12;
export const BTN_DPAD_DOWN = 13;
export const BTN_DPAD_LEFT = 14;
export const BTN_DPAD_RIGHT = 15;

export const STICK_DEADZONE = 0.5;

/** Logical inputs tracked for edge detection, in `prev` order. */
const LOGICAL: ReadonlyArray<Intent> = [
  turnIntent(DIR_UP), turnIntent(DIR_DOWN), turnIntent(DIR_LEFT), turnIntent(DIR_RIGHT),
  INTENT_PAUSE, INTENT_RESTART
];
export const LOGICAL_COUNT = LOGICAL.length;

/**
 * Reduces raw pad state to the six logical inputs. D-pad buttons, the left
 * stick past the deadzone, and the face/menu buttons all fold into the same
 * intents the keyboard produces.
 */
export function readLogical(buttons: ReadonlyArray<boolean>, axes: ReadonlyArray<number>, out: Uint8Array): void {
  const ax = axes[0] ?? 0;
  const ay = axes[1] ?? 0;
  out[0] = buttons[BTN_DPAD_UP] || ay < -STICK_DEADZONE ? 1 : 0;
  out[1] = buttons[BTN_DPAD_DOWN] || ay > STICK_DEADZONE ? 1 : 0;
  out[2] = buttons[BTN_DPAD_LEFT] || ax < -STICK_DEADZONE ? 1 : 0;
  out[3] = buttons[BTN_DPAD_RIGHT] || ax > STICK_DEADZONE ? 1 : 0;
  out[4] = buttons[BTN_START] || buttons[BTN_A] ? 1 : 0;
  out[5] = buttons[BTN_SELECT] || buttons[BTN_B] ? 1 : 0;
}

/**
 * Emits one intent per rising edge of each logical input, then stores the
 * new state in `prev`. Pure: callable from tests with synthetic pads.
 */
export function edgeIntents(now: Uint8Array, prev: Uint8Array, queue: IntentQueue): number {
  let n = 0;
  for (let i = 0; i < LOGICAL_COUNT; i++) {
    if (now[i] === 1 && prev[i] === 0) {
      queue.push(LOGICAL[i]!);
      n++;
    }
    prev[i] = now[i]!;
  }
  return n;
}

export interface GamepadPoller {
  /** Poll once per frame. */
  poll(): void;
}

const pressed: boolean[] = new Array<boolean>(16).fill(false);
const axesBuf: number[] = [0, 0];

export function createGamepadPoller(nav: Navigator, queue: IntentQueue): GamepadPoller {
  const now = new Uint8Array(LOGICAL_COUNT);
  const prev = new Uint8Array(LOGICAL_COUNT);
  return {
    poll() {
      if (typeof nav.getGamepads !== "function") return;
      const pads = nav.getGamepads();
      let pad: Gamepad | null = null;
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected) {
          pad = p;
          break;
        }
      }
      if (!pad) {
        prev.fill(0);
        return;
      }
      for (let i = 0; i < 16; i++) pressed[i] = pad.buttons[i]?.pressed === true;
      axesBuf[0] = pad.axes[0] ?? 0;
      axesBuf[1] = pad.axes[1] ?? 0;
      readLogical(pressed, axesBuf, now);
      edgeIntents(now, prev, queue);
    }
  };
}
