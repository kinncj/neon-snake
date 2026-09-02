import type { Dir, Intent } from "../../domain/types";

/**
 * Shared preallocated intent queue. Both the keyboard and gamepad adapters
 * push `Intent` values here; the runtime drains it once per fixed tick. The
 * ring buffer is a fixed capacity allocated once — overflow drops the oldest
 * intent, it never grows.
 */
export type IntentKind = "turn" | "pause" | "restart";

interface Slot {
  kind: IntentKind;
  dir: Dir;
}

export const QUEUE_CAPACITY = 32;

export class IntentQueue {
  private readonly buf: Slot[];
  private head = 0; // next to read
  private size = 0;

  constructor(capacity: number = QUEUE_CAPACITY) {
    this.buf = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.buf[i] = { kind: "pause", dir: 1 };
  }

  /** Enqueue an intent; overwrites the oldest when full. Never allocates. */
  push(kind: IntentKind, dir: Dir = 1): void {
    const write = (this.head + this.size) % this.buf.length;
    const slot = this.buf[write]!;
    slot.kind = kind;
    slot.dir = dir;
    if (this.size < this.buf.length) {
      this.size++;
    } else {
      this.head = (this.head + 1) % this.buf.length;
    }
  }

  /** Dequeue the oldest intent, or null when empty. */
  pop(): Intent | null {
    if (this.size === 0) return null;
    const slot = this.buf[this.head]!;
    const out: Intent =
      slot.kind === "turn" ? { kind: "turn", dir: slot.dir } : { kind: slot.kind };
    this.head = (this.head + 1) % this.buf.length;
    this.size--;
    return out;
  }

  get length(): number {
    return this.size;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}

/**
 * Pure keyboard mapping. Returns the intent to push plus whether the browser
 * default should be prevented (arrows and space scroll the page).
 */
export interface KeyResult {
  readonly intent: Intent | null;
  readonly prevent: boolean;
}

const ARROWS: Record<string, Dir> = {
  ArrowUp: 0,
  KeyW: 0,
  ArrowRight: 1,
  KeyD: 1,
  ArrowDown: 2,
  KeyS: 2,
  ArrowLeft: 3,
  KeyA: 3
};

export function keyToIntent(code: string): KeyResult {
  const dir = ARROWS[code];
  if (dir !== undefined) return { intent: { kind: "turn", dir }, prevent: true };
  if (code === "KeyP" || code === "Escape") return { intent: { kind: "pause" }, prevent: false };
  if (code === "KeyR") return { intent: { kind: "restart" }, prevent: false };
  if (code === "Space") return { intent: null, prevent: true };
  return { intent: null, prevent: false };
}

/** Wire window keydown to the queue. Returns a detach function. */
export function attachKeyboard(queue: IntentQueue, target: Window): () => void {
  const handler = (e: KeyboardEvent): void => {
    const r = keyToIntent(e.code);
    if (r.intent !== null) queue.push(r.intent.kind, r.intent.kind === "turn" ? r.intent.dir : 1);
    if (r.prevent) e.preventDefault();
  };
  target.addEventListener("keydown", handler);
  return () => target.removeEventListener("keydown", handler);
}
