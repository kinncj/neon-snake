import { type Dir, type Intent, DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, turnIntent } from "../../domain/types";
import type { IntentQueue } from "./queue";

/** Minimum travel, in css px, before a swipe is recognised. */
export const SWIPE_PX = 24;

/**
 * Swipe recogniser: one intent per gesture, dominant axis wins. Pure, so
 * tests can drive it with coordinates.
 */
export interface Swipe {
  begin(x: number, y: number): void;
  /** Returns the recognised turn intent once per gesture, else -1. */
  move(x: number, y: number): Intent;
  end(): void;
  active(): boolean;
}

export function createSwipe(threshold = SWIPE_PX): Swipe {
  let sx = 0;
  let sy = 0;
  let tracking = false;
  let fired = false;
  return {
    begin(x, y) {
      sx = x;
      sy = y;
      tracking = true;
      fired = false;
    },
    move(x, y) {
      if (!tracking || fired) return -1;
      const dx = x - sx;
      const dy = y - sy;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (Math.max(ax, ay) < threshold) return -1;
      fired = true;
      let d: Dir;
      if (ax >= ay) d = dx > 0 ? DIR_RIGHT : DIR_LEFT;
      else d = dy > 0 ? DIR_DOWN : DIR_UP;
      return turnIntent(d);
    },
    end() {
      tracking = false;
      fired = false;
    },
    active: () => tracking
  };
}

/** Attaches non-passive touch listeners that feed the swipe recogniser. */
export function attachTouch(target: HTMLElement, queue: IntentQueue): () => void {
  const swipe = createSwipe();
  const onStart = (e: TouchEvent): void => {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (t) swipe.begin(t.clientX, t.clientY);
  };
  const onMove = (e: TouchEvent): void => {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (!t) return;
    const intent = swipe.move(t.clientX, t.clientY);
    if (intent >= 0) queue.push(intent);
  };
  const onEnd = (): void => swipe.end();
  const opts: AddEventListenerOptions = { passive: false };
  target.addEventListener("touchstart", onStart, opts);
  target.addEventListener("touchmove", onMove, opts);
  target.addEventListener("touchend", onEnd);
  target.addEventListener("touchcancel", onEnd);
  return () => {
    target.removeEventListener("touchstart", onStart);
    target.removeEventListener("touchmove", onMove);
    target.removeEventListener("touchend", onEnd);
    target.removeEventListener("touchcancel", onEnd);
  };
}

export interface Dpad {
  root: HTMLElement;
  setVisible(v: boolean): void;
  isVisible(): boolean;
}

const DPAD_BUTTONS: ReadonlyArray<[string, Dir, string]> = [
  ["up", DIR_UP, "▲"],
  ["left", DIR_LEFT, "◀"],
  ["right", DIR_RIGHT, "▶"],
  ["down", DIR_DOWN, "▼"]
];

/**
 * The on-screen d-pad. Hidden by default; the settings panel owns its
 * visibility. Presses vibrate briefly where the platform allows it.
 */
export function createDpad(queue: IntentQueue, doc: Document = document): Dpad {
  const root = doc.createElement("div");
  root.id = "dpad";
  root.hidden = true;
  root.setAttribute("aria-label", "direction pad");
  for (const [name, dir, glyph] of DPAD_BUTTONS) {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "dpad-btn dpad-" + name;
    b.dataset["dir"] = String(dir);
    b.dataset["i18n"] = "dpad_" + name;
    b.dataset["i18nAttr"] = "aria-label";
    b.setAttribute("aria-label", name);
    b.textContent = glyph;
    const press = (e: Event): void => {
      e.preventDefault();
      queue.push(turnIntent(dir));
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try {
          navigator.vibrate(10);
        } catch {
          /* not permitted: ignore */
        }
      }
    };
    b.addEventListener("pointerdown", press);
    root.appendChild(b);
  }
  return {
    root,
    setVisible(v) {
      root.hidden = !v;
    },
    isVisible: () => !root.hidden
  };
}
