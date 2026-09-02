// Shared preallocated intent queue: the transport between the input
// adapters (keyboard, gamepad, touch) and the runtime loop.
//
// Fixed capacity, no per-event allocation. Adapters push Intents; the loop
// drains them (up to a batch per tick) and feeds the domain. When the queue
// is full the oldest intent is dropped so the player's latest input always
// wins — backpressure for the actual turn buffer lives in the domain
// (MAX_PENDING), this is just a short-lived transport.

import type { Intent } from "../../domain/types";

export class IntentQueue {
  private readonly cap: number;
  private readonly buf: (Intent | undefined)[];
  private head = 0; // index of the oldest entry
  private len = 0;

  constructor(capacity: number) {
    this.cap = Math.max(1, capacity);
    this.buf = new Array(this.cap);
  }

  get size(): number {
    return this.len;
  }

  get capacity(): number {
    return this.cap;
  }

  push(intent: Intent): void {
    if (this.len === this.cap) {
      // full: drop the oldest so the newest input is kept
      this.head = (this.head + 1) % this.cap;
      this.len--;
    }
    const tail = (this.head + this.len) % this.cap;
    this.buf[tail] = intent;
    this.len++;
  }

  /** Pop up to `max` intents into the preallocated `out` (FIFO). Returns the
   * number popped. */
  drain(max: number, out: Intent[]): number {
    let n = 0;
    while (n < max && this.len > 0) {
      out[n] = this.buf[this.head]!;
      this.head = (this.head + 1) % this.cap;
      this.len--;
      n++;
    }
    return n;
  }

  clear(): void {
    this.head = 0;
    this.len = 0;
  }
}
