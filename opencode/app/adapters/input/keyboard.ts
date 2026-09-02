// Keyboard input adapter.
//
// Maps physical key codes (layout-independent) to Intents and pushes them
// into the shared IntentQueue. Arrows + WASD steer, P/Esc pause, R restart.
// Arrow keys and Space call preventDefault so the page never scrolls or
// re-focuses while playing.
//
// The mapping is a pure function (keyIntent) so it is unit-testable without
// a DOM; attachKeyboard wires the browser event to it.

import type { Dir, Intent } from "../../domain/types";
import type { IntentQueue } from "./queue";

/** Physical key code -> steering direction. Arrows and WASD. */
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 0,
  KeyW: 0,
  ArrowRight: 1,
  KeyD: 1,
  ArrowDown: 2,
  KeyS: 2,
  ArrowLeft: 3,
  KeyA: 3
};

/** Key codes that must not also scroll the page / activate widgets. */
const PREVENT_DEFAULT = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space"
]);

/** Pure key-code -> intent mapping (null = not a game key). */
export function keyIntent(code: string): Intent | null {
  const dir = KEY_DIR[code];
  if (dir !== undefined) return { kind: "turn", dir };
  if (code === "KeyP" || code === "Escape") return { kind: "pause" };
  if (code === "KeyR") return { kind: "restart" };
  return null;
}

/** True when the code should have its default action suppressed. */
export function shouldPreventDefault(code: string): boolean {
  return PREVENT_DEFAULT.has(code);
}

/** Attach the keyboard to the shared queue; returns a detach function. */
export function attachKeyboard(queue: IntentQueue): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (shouldPreventDefault(e.code)) e.preventDefault();
    const intent = keyIntent(e.code);
    if (intent !== null) queue.push(intent);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
