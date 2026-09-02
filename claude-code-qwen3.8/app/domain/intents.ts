// Intent buffering. A turn is queued (up to MAX_PENDING) so the player can chain
// two quick turns per tick; the loop drains one queued turn per tick. Pause and
// restart are immediate. Restart is NOT applied here — it replaces the state
// object, which the caller does via init(seed).
import { MAX_PENDING, opposite, type Dir, type Intent, type SnakeState } from './types'

export function enqueueTurn(s: SnakeState, dir: Dir): void {
  if (s.pendingLen >= MAX_PENDING) return // full -> drop
  // Reject a 180° reversal (or no-op) against the last buffered turn, or against
  // the current heading when the buffer is empty.
  const ref: Dir = s.pendingLen > 0 ? ((s.pendingDir[s.pendingLen - 1] ?? s.dir) as Dir) : s.dir
  if (dir === opposite(ref)) return
  if (dir === ref) return
  s.pendingDir[s.pendingLen] = dir
  s.pendingLen++
}

export function togglePause(s: SnakeState): void {
  if (s.phase === 'playing') s.phase = 'paused'
  else if (s.phase === 'paused') s.phase = 'playing'
}

/**
 * Apply a turn or pause intent, returning the state to use. A restart intent is
 * a no-op here; the caller re-inits via init(seed) and reassigns its state.
 */
export function enqueue(s: SnakeState, intent: Intent): SnakeState {
  if (intent.kind === 'turn') enqueueTurn(s, intent.dir ?? s.dir)
  else if (intent.kind === 'pause') togglePause(s)
  return s
}
