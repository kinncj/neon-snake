import { type Intent, DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, INTENT_PAUSE, INTENT_RESTART, turnIntent } from "../../domain/types";
import type { IntentQueue } from "./queue";

/** Maps a KeyboardEvent.code to an intent, or -1 when the key is unbound. */
export function mapKey(code: string): Intent {
  switch (code) {
    case "ArrowUp":
    case "KeyW":
      return turnIntent(DIR_UP);
    case "ArrowDown":
    case "KeyS":
      return turnIntent(DIR_DOWN);
    case "ArrowLeft":
    case "KeyA":
      return turnIntent(DIR_LEFT);
    case "ArrowRight":
    case "KeyD":
      return turnIntent(DIR_RIGHT);
    case "KeyP":
    case "Escape":
      return INTENT_PAUSE;
    case "KeyR":
      return INTENT_RESTART;
    default:
      return -1;
  }
}

/** Keys whose browser default (scrolling) must be suppressed. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

export interface KeyboardOptions {
  /** Return true to swallow the key (an open dialog, for example). */
  blocked?: () => boolean;
}

/** Attaches the keyboard adapter; returns a detach function. */
export function attachKeyboard(target: Window, queue: IntentQueue, opts: KeyboardOptions = {}): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (SCROLL_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (opts.blocked && opts.blocked()) return;
    const intent = mapKey(e.code);
    if (intent < 0) return;
    queue.push(intent);
  };
  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}
