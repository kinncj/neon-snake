import { MAX_PENDING } from "./types";
import type { Dir, Intent, State } from "./types";

// Mutable view over the long-lived State record. The engine mutates in
// place; the `readonly` surface is the contract read by renderers/audio.
type MutableState = {
  -readonly [K in keyof State]: State[K] extends readonly (infer T)[] ? T[] : State[K];
};

/** 180° opposite of each Dir: up<->down (0<->2), right<->left (1<->3). */
const OPPOSITE: readonly Dir[] = [2, 3, 0, 1];

/**
 * Buffer a turn intent. Returns the state unchanged when the intent is
 * rejected (opposite of the reference direction, no-op, or queue full) or
 * when it is not a turn (pause/restart are consumed by the tick loop).
 */
export function enqueue(s: State, intent: Intent): State {
  if (intent.kind !== "turn") return s;
  const m = s as MutableState;
  const ref: Dir = m.pendingLen > 0 ? m.pending[m.pendingLen - 1]! : m.dir;
  if (intent.dir === ref || intent.dir === OPPOSITE[ref]) return s;
  if (m.pendingLen === MAX_PENDING) return s;
  m.pending[m.pendingLen] = intent.dir;
  m.pendingLen += 1;
  return s;
}
