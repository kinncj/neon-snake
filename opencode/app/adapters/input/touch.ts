// Touch input adapter: swipe-to-steer over the screen and an on-screen
// d-pad.
//
// Swipe: one intent per gesture. The decision is made on touchend from the
// total travel; the dominant axis wins; anything under SWIPE_MIN_PX is noise
// (a tap) and emits nothing. Listeners are non-passive and preventDefault so
// the browser never scrolls or pull-to-refresh mid-gesture.
//
// D-pad: four buttons in a fixed grid, hidden by default — the settings panel
// (a later step) owns visibility. Presses vibrate (10 ms) where available.

import type { Dir } from "../../domain/types";
import type { IntentQueue } from "./queue";

/** Minimum CSS-px travel (either axis) before a swipe registers. */
export const SWIPE_MIN_PX = 24;

/**
 * Pure swipe decision: travel deltas (CSS px) -> direction, or null when the
 * gesture is below the minimum in both axes. The dominant axis wins; on a
 * tie the horizontal axis takes it.
 */
export function swipeDir(dx: number, dy: number): Dir | null {
  if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

/**
 * Apply the touch-related CSS the spec requires: touch-action none on the
 * canvas and its container, overscroll-behavior none on html/body. Done from
 * the adapter so the touch contract lives in one place.
 */
export function applyTouchCss(
  canvas: HTMLCanvasElement,
  container: HTMLElement
): void {
  canvas.style.touchAction = "none";
  container.style.touchAction = "none";
  document.documentElement.style.overscrollBehavior = "none";
  document.body.style.overscrollBehavior = "none";

  // D-pad + toggle styling, positioned inside the safe-area insets. CSS vars
  // fall back to env() so a real device's notch/home-indicator is respected;
  // the vars also let tests simulate an inset.
  const style = document.createElement("style");
  style.textContent = `
    #dpad {
      position: fixed;
      z-index: 10;
      display: none;
      grid-template-areas: ". up ." "left . right" ". down .";
      grid-template-columns: repeat(3, 58px);
      grid-template-rows: repeat(3, 58px);
      gap: 8px;
      /* portrait: bottom-centre, clear of the TV bezel (~8% of the height) */
      left: 50%;
      bottom: calc(8% + var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 12px);
      transform: translateX(-50%);
    }
    /* landscape: dock to the left, vertically centred (thumb reach) */
    @media (orientation: landscape) {
      #dpad {
        left: calc(5% + var(--safe-left, env(safe-area-inset-left, 0px)) + 12px);
        bottom: auto;
        top: 50%;
        transform: translateY(-50%);
      }
    }
    #dpad.visible { display: grid; }
    #dpad button {
      width: 58px; height: 58px;
      background: rgba(8, 12, 34, 0.5);
      color: var(--neon, #00e5ff);
      border: 1px solid var(--neon-glow, rgba(0, 229, 255, 0.45));
      border-radius: 16px;
      font-size: 22px; line-height: 1;
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
      box-shadow:
        0 0 12px var(--neon-glow, rgba(0, 229, 255, 0.28)),
        inset 0 0 10px var(--neon-glow, rgba(0, 229, 255, 0.16));
      touch-action: manipulation;
      -webkit-user-select: none; user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition: background 0.08s ease-out, transform 0.08s ease-out;
    }
    #dpad button:active {
      background: color-mix(in srgb, var(--neon, #00e5ff) 32%, rgba(8,12,34,0.5));
      color: #fff;
      transform: scale(0.93);
    }
  `;
  document.head.appendChild(style);
}

interface SwipeState {
  active: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

/**
 * Swipe -> turn. One intent per gesture: the decision is made on touchend
 * from the total travel, and the dominant axis wins. Reset on touchend /
 * touchcancel. Listeners are non-passive so preventDefault stops scroll and
 * pull-to-refresh.
 */
export function attachSwipe(queue: IntentQueue, target: HTMLElement): () => void {
  const s: SwipeState = { active: false, startX: 0, startY: 0, lastX: 0, lastY: 0 };

  const onStart = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (t === undefined) return;
    s.active = true;
    s.startX = t.clientX;
    s.startY = t.clientY;
    s.lastX = t.clientX;
    s.lastY = t.clientY;
    e.preventDefault();
  };
  const onMove = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (t !== undefined) {
      s.lastX = t.clientX;
      s.lastY = t.clientY;
    }
    e.preventDefault();
  };
  const onEnd = (e: TouchEvent): void => {
    e.preventDefault();
    if (s.active) {
      const dir = swipeDir(s.lastX - s.startX, s.lastY - s.startY);
      if (dir !== null) queue.push({ kind: "turn", dir });
    }
    s.active = false;
  };

  target.addEventListener("touchstart", onStart, { passive: false });
  target.addEventListener("touchmove", onMove, { passive: false });
  target.addEventListener("touchend", onEnd, { passive: false });
  target.addEventListener("touchcancel", onEnd, { passive: false });
  return () => {
    target.removeEventListener("touchstart", onStart);
    target.removeEventListener("touchmove", onMove);
    target.removeEventListener("touchend", onEnd);
    target.removeEventListener("touchcancel", onEnd);
  };
}

/**
 * On-screen d-pad. Visibility is owned by the settings panel (it starts
 * hidden; the settings toggle turns it on). Positioned inside the safe-area
 * insets; vibrates (10 ms) on press where available.
 */
export function createDpad(queue: IntentQueue): {
  root: HTMLElement;
  setVisible(v: boolean): void;
  isVisible(): boolean;
} {
  const root = document.createElement("div");
  root.id = "dpad";

  const defs: ReadonlyArray<readonly [string, Dir, string]> = [
    ["up", 0, "▲"],
    ["left", 3, "◀"],
    ["right", 1, "▶"],
    ["down", 2, "▼"]
  ];
  for (const [name, dir, glyph] of defs) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.dir = String(dir);
    b.setAttribute("aria-label", name);
    b.style.gridArea = name;
    b.textContent = glyph;
    b.addEventListener("pointerdown", () => {
      queue.push({ kind: "turn", dir });
      if (typeof navigator.vibrate === "function") navigator.vibrate(10);
    });
    root.appendChild(b);
  }

  let visible = false; // off by default; settings turns it on
  const setVisible = (v: boolean): void => {
    visible = v;
    root.classList.toggle("visible", v);
  };

  // Append into #screen (falling back to body) so the d-pad shares the game's
  // stacking context (it must sit above the pause/title overlays at z-8).
  const parent = document.getElementById("screen") ?? document.body;
  parent.append(root);
  return { root, setVisible, isVisible: () => visible };
}

/** Wire swipe + d-pad to the queue. Returns a detach fn + the d-pad handle. */
export function attachTouch(
  queue: IntentQueue,
  target: HTMLElement,
  canvas: HTMLCanvasElement
): {
  detach(): void;
  dpad: { root: HTMLElement; setVisible(v: boolean): void; isVisible(): boolean };
} {
  applyTouchCss(canvas, target);
  const detach = attachSwipe(queue, target);
  const dpad = createDpad(queue);
  return { detach, dpad };
}
