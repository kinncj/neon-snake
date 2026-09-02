import {
  type Dir, type Intent, type State,
  MAX_PENDING, INTENT_PAUSE, INTENT_RESTART, intentKind, intentDir, opposite
} from "./types";

/**
 * Queues a turn. The reference direction is the newest pending turn, or the
 * current heading when nothing is pending. A turn is:
 *  - rejected when it reverses the reference (180 degrees),
 *  - rejected when it equals the reference (a no-op turn),
 *  - dropped when the buffer is full,
 *  - otherwise appended.
 * Returns true when the turn was queued.
 */
export function enqueueTurn(s: State, d: Dir): boolean {
  const ref: Dir = s.pendingLen > 0 ? (s.pending[s.pendingLen - 1] as Dir) : s.dir;
  if (d === opposite(ref)) return false;
  if (d === ref) return false;
  if (s.pendingLen >= MAX_PENDING) return false;
  s.pending[s.pendingLen] = d;
  s.pendingLen++;
  return true;
}

/**
 * Applies an intent to the state. Turns go through the buffer; `pause`
 * toggles playing/paused (a no-op in gameover); `restart` is left to the
 * caller (`step.ts` owns re-initialisation) and reports false here.
 */
export function enqueue(s: State, intent: Intent): boolean {
  switch (intentKind(intent)) {
    case "turn":
      return enqueueTurn(s, intentDir(intent));
    case "pause":
      if (s.phase === "playing") s.phase = "paused";
      else if (s.phase === "paused") s.phase = "playing";
      else return false;
      return true;
    case "restart":
      return false;
  }
}

export { INTENT_PAUSE, INTENT_RESTART };
