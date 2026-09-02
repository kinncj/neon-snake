// Core grid + entity types. This is the single source of truth for the
// simulation's shape; the renderers and audio read these (they never mutate
// them). No DOM, no timers, no clock, no Math.random — the domain is pure.

export const GRID_W: number = 32
export const GRID_H: number = 30
export const CELL_PX: number = 8
/** Virtual framebuffer the 2D composite draws into (256x240). */
export const FRAME_W: number = GRID_W * CELL_PX // 256
export const FRAME_H: number = GRID_H * CELL_PX // 240
/** Preallocated body capacity — the snake can never exceed the grid. */
export const BODY_CAP: number = GRID_W * GRID_H // 960
/** Fixed intent buffer depth (a few buffered turns). */
export const MAX_PENDING: number = 3
/** Fixed-capacity preallocated effect ring the consumer resets each frame. */
export const EFFECT_CAP: number = 32

// Direction encoding: 0=up, 1=right, 2=down, 3=left. Opposite pairs: 0<->2, 1<->3.
export type Dir = 0 | 1 | 2 | 3
export type Phase = 'playing' | 'paused' | 'gameover'
export type EffectKind = 'ate' | 'grew' | 'turned' | 'died' | 'spawned' | 'levelup'
export type EffectCause = 'wall' | 'self' | 'none'

/** A player intent. `dir` is present only for a turn. */
export interface Intent {
  kind: 'turn' | 'pause' | 'restart'
  dir?: Dir
}

/** One event the simulation emits to the presentation layer. */
export interface Effect {
  kind: EffectKind
  x: number
  y: number
  value: number
  cause: EffectCause
}

/** Fixed-capacity preallocated effect ring. `sinkReset` before each frame's reads. */
export interface EffectSink {
  buf: Effect[]
  len: number
}

export function createSink(): EffectSink {
  const buf: Effect[] = []
  for (let i = 0; i < EFFECT_CAP; i++) buf.push({ kind: 'turned', x: 0, y: 0, value: 0, cause: 'none' })
  return { buf, len: 0 }
}

export function sinkReset(sink: EffectSink): void {
  sink.len = 0
}

/** Write an event into the ring in place (no allocation); drops when full. */
export function sinkPush(
  sink: EffectSink,
  kind: EffectKind,
  x: number,
  y: number,
  value: number,
  cause: EffectCause,
): void {
  if (sink.len >= EFFECT_CAP) return
  const e = sink.buf[sink.len]!
  e.kind = kind
  e.x = x
  e.y = y
  e.value = value
  e.cause = cause
  sink.len++
}

/** The whole simulation state. All buffers are preallocated at full capacity. */
export interface SnakeState {
  tick: number
  dir: Dir
  phase: Phase
  /** Body as parallel x/y, head at index 0; live length is `bodyLen`. */
  bodyX: Int32Array
  bodyY: Int32Array
  bodyLen: number
  foodX: number
  foodY: number
  score: number
  /** 1-based, re-derived from `score` every tick. */
  level: number
  /** Current combo multiplier, 1..MAX_COMBO. */
  combo: number
  /** Tick of the previous eat, or -1 before the first eat (drives the combo window). */
  lastEatTick: number
  /** xorshift32 state (uint32, non-zero). */
  rng: number
  /** Buffered turn queue (Dir as 0..3), head at 0. */
  pendingDir: Uint8Array
  pendingLen: number
  /** Seed string; `restart` re-inits with it. */
  seed: string
  /** Best score this session (client-side, mirrored to storage by the adapter). */
  highScore: number
  /** Occupancy grid, `occ[y * GRID_W + x]` is 1 when a body cell is there. */
  occ: Uint8Array
}

export function createState(): SnakeState {
  return {
    tick: 0,
    dir: 1,
    phase: 'playing',
    bodyX: new Int32Array(BODY_CAP),
    bodyY: new Int32Array(BODY_CAP),
    bodyLen: 0,
    foodX: -1,
    foodY: -1,
    score: 0,
    level: 1,
    combo: 1,
    lastEatTick: -1,
    rng: 0,
    pendingDir: new Uint8Array(MAX_PENDING),
    pendingLen: 0,
    seed: '',
    highScore: 0,
    occ: new Uint8Array(GRID_W * GRID_H),
  }
}

// Direction deltas, indexed by Dir (0=up, 1=right, 2=down, 3=left).
export const DX: readonly number[] = [0, 1, 0, -1]
export const DY: readonly number[] = [-1, 0, 1, 0]

export function opposite(d: Dir): Dir {
  return (d ^ 2) as Dir
}
