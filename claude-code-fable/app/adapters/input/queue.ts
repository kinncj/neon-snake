import type { Intent } from "../../domain/types";

/**
 * A preallocated intent ring shared by every input adapter. Producers push
 * from event handlers; the runtime drains it once per frame into the
 * domain. Overflow drops the newest intent (a mash never grows memory).
 */
export interface IntentQueue {
  push(intent: Intent): boolean;
  /** Oldest intent, or -1 when empty. */
  shift(): Intent;
  size(): number;
  clear(): void;
}

export const QUEUE_CAP = 16;

export function createIntentQueue(cap = QUEUE_CAP): IntentQueue {
  const buf = new Uint8Array(cap);
  let head = 0;
  let len = 0;
  return {
    push(intent) {
      if (len >= cap) return false;
      buf[(head + len) % cap] = intent;
      len++;
      return true;
    },
    shift() {
      if (len === 0) return -1;
      const v = buf[head]!;
      head = (head + 1) % cap;
      len--;
      return v;
    },
    size: () => len,
    clear() {
      head = 0;
      len = 0;
    }
  };
}
