// Intent buffering. Player input never moves the snake directly; it is
// queued here and consumed one entry per tick by step(). Keeping the buffer
// short (MAX_PENDING) is what makes the game feel responsive without letting
// a rapid mashing of keys queue up a long turn that the player no longer
// intended.
//
// Pure: reads and mutates the preallocated State, allocates nothing.

import { MAX_PENDING } from "./types";
import type { Dir, Intent, State } from "./types";

// Mutable view over the long-lived State record. The engine mutates in
// place; the `readonly` surface is the contract read by renderers/audio.
type MutableState = {
  -readonly [K in keyof State]: State[K] extends readonly (infer T)[]
    ? T[]
    : State[K];
};

/** 180° opposite of each Dir: up<->down (0<->2), right<->left (1<->3). */
const OPPOSITE: readonly Dir[] = [2, 3, 0, 1];

/**
 * Buffer a turn intent.
 *
 * The reference direction is the last buffered entry when the buffer is
 * non-empty (so a queued U-turn is checked against what was just queued,
 * not against the stale dir), or `dir` when it is empty.
 *
 * Rejected (state returned unchanged) when:
 *   - the turn equals the reference direction (a no-op), or
 *   - the turn is the 180° opposite of the reference (would reverse into
 *     the neck), or
 *   - the buffer is already full (dropped, not replacing anything).
 *
 * Non-turn intents (pause/restart) are not buffered; the tick loop consumes
 * them. This function is a no-op for those.
 */
export function enqueue(s: State, intent: Intent): State {
  if (intent.kind !== "turn") return s;
  const m = s as MutableState;
  const ref: Dir = m.pendingLen > 0 ? m.pending[m.pendingLen - 1]! : m.dir;
  if (intent.dir === ref) return s;
  if (intent.dir === OPPOSITE[ref]) return s;
  if (m.pendingLen === MAX_PENDING) return s;
  m.pending[m.pendingLen] = intent.dir;
  m.pendingLen += 1;
  return s;
}
