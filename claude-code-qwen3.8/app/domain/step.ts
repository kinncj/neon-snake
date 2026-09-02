// The fixed-tick simulation. `init(seed)` builds a fresh state; `step` advances
// exactly one tick (movement, food/growth/score, collision, level) and emits
// effects into the sink. Integer-only; no wall-clock; advances one tick at a
// time so a replay of intents reproduces the same state (and hash) every run.
import {
  DX,
  DY,
  GRID_H,
  GRID_W,
  createState,
  sinkPush,
  type EffectCause,
  type EffectSink,
  type Dir,
  type SnakeState,
} from './types'
import { next, rangeOf, seedFrom } from './rng'
import { COMBO_WINDOW_TICKS, foodValueForLevel, levelForScore, MAX_COMBO } from './levels'

const START_HX = 16
const START_HY = 15
const START_LEN = 3
const REJECT_CAP = 256

function isOccupied(s: SnakeState, x: number, y: number): boolean {
  return s.occ[y * GRID_W + x] === 1
}

/**
 * Rejection-sample a free cell with the seeded PRNG (up to 256 draws), falling
 * back to a deterministic linear scan. Leaves no food (foodX/Y = -1) if the
 * snake fills the board.
 */
function placeFood(s: SnakeState): void {
  let placed = false
  for (let a = 0; a < REJECT_CAP && !placed; a++) {
    s.rng = next(s.rng)
    const cx = rangeOf(s.rng, GRID_W)
    s.rng = next(s.rng)
    const cy = rangeOf(s.rng, GRID_H)
    if (!isOccupied(s, cx, cy)) {
      s.foodX = cx
      s.foodY = cy
      placed = true
    }
  }
  if (!placed) {
    outer: for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (!isOccupied(s, x, y)) {
          s.foodX = x
          s.foodY = y
          placed = true
          break outer
        }
      }
    }
  }
  if (!placed) {
    s.foodX = -1
    s.foodY = -1
  }
}

function spawnFood(s: SnakeState, sink: EffectSink): void {
  placeFood(s)
  if (s.foodX !== -1) sinkPush(sink, 'spawned', s.foodX, s.foodY, 0, 'none')
}

function die(s: SnakeState, sink: EffectSink, cause: EffectCause): void {
  s.phase = 'gameover'
  if (s.score > s.highScore) s.highScore = s.score
  sinkPush(sink, 'died', s.bodyX[0] ?? 0, s.bodyY[0] ?? 0, s.score, cause)
}

export function init(seed: string): SnakeState {
  const s = createState()
  s.seed = seed
  s.rng = seedFrom(seed)
  s.dir = 1 // right
  s.phase = 'playing'
  for (let i = 0; i < START_LEN; i++) {
    s.bodyX[i] = START_HX - i
    s.bodyY[i] = START_HY
  }
  s.bodyLen = START_LEN
  s.occ.fill(0)
  for (let i = 0; i < s.bodyLen; i++) s.occ[(s.bodyY[i] ?? 0) * GRID_W + (s.bodyX[i] ?? 0)] = 1
  placeFood(s)
  return s
}

export function step(s: SnakeState, sink: EffectSink): void {
  if (s.phase !== 'playing') return // paused / gameover advance nothing

  s.tick++
  // Re-derive the level from score (tier-independent); the runtime reads this to
  // pick the tick interval.
  s.level = levelForScore(s.score)

  // Drain one buffered turn into the heading.
  if (s.pendingLen > 0) {
    const d = (s.pendingDir[0] ?? s.dir) as Dir
    for (let i = 0; i < s.pendingLen - 1; i++) s.pendingDir[i] = s.pendingDir[i + 1] ?? s.dir
    s.pendingLen--
    if (d !== s.dir) {
      s.dir = d
      sinkPush(sink, 'turned', s.bodyX[0] ?? 0, s.bodyY[0] ?? 0, 0, 'none')
    }
  }

  const dx = DX[s.dir] ?? 0
  const dy = DY[s.dir] ?? 0
  const nhx = (s.bodyX[0] ?? 0) + dx
  const nhy = (s.bodyY[0] ?? 0) + dy

  // Wall collision (solid, no wrap).
  if (nhx < 0 || nhy < 0 || nhx >= GRID_W || nhy >= GRID_H) {
    die(s, sink, 'wall')
    return
  }

  const willGrow = s.foodX !== -1 && nhx === s.foodX && nhy === s.foodY

  // Self collision: the tail vacates on a non-grow move, so exclude it then.
  const lastIdx = willGrow ? s.bodyLen - 1 : s.bodyLen - 2
  for (let i = 1; i <= lastIdx; i++) {
    if ((s.bodyX[i] ?? -1) === nhx && (s.bodyY[i] ?? -1) === nhy) {
      die(s, sink, 'self')
      return
    }
  }

  const oldLen = s.bodyLen
  const oldTailX = s.bodyX[oldLen - 1] ?? 0
  const oldTailY = s.bodyY[oldLen - 1] ?? 0

  // Advance the body by index (no allocation): each segment takes the cell ahead.
  if (willGrow) {
    for (let i = oldLen; i >= 1; i--) {
      s.bodyX[i] = s.bodyX[i - 1] ?? 0
      s.bodyY[i] = s.bodyY[i - 1] ?? 0
    }
    s.bodyLen = oldLen + 1
  } else {
    for (let i = oldLen - 1; i >= 1; i--) {
      s.bodyX[i] = s.bodyX[i - 1] ?? 0
      s.bodyY[i] = s.bodyY[i - 1] ?? 0
    }
  }
  s.bodyX[0] = nhx
  s.bodyY[0] = nhy

  s.occ[nhy * GRID_W + nhx] = 1
  if (!willGrow) s.occ[oldTailY * GRID_W + oldTailX] = 0

  if (willGrow) {
    // Combo: an eat within the window of the previous eat raises the multiplier.
    const within = s.lastEatTick >= 0 && s.tick - s.lastEatTick <= COMBO_WINDOW_TICKS
    s.combo = within ? Math.min(s.combo + 1, MAX_COMBO) : 1
    const value = foodValueForLevel(s.level) * s.combo
    s.score += value
    s.lastEatTick = s.tick
    sinkPush(sink, 'ate', nhx, nhy, value, 'none')
    sinkPush(sink, 'grew', nhx, nhy, value, 'none')
    spawnFood(s, sink)
    const nl = levelForScore(s.score)
    if (nl > s.level) {
      s.level = nl
      sinkPush(sink, 'levelup', nhx, nhy, nl, 'none')
    }
  }
}
