// Domain types. Everything here is plain data on preallocated typed arrays:
// the simulation never allocates after init, never touches the platform, and
// never measures time. See eslint.config.js for the enforced boundary.

export const GRID_W = 32;
export const GRID_H = 30;
export const CELL_PX = 8;
export const FB_W = GRID_W * CELL_PX; // 256
export const FB_H = GRID_H * CELL_PX; // 240
export const CELL_COUNT = GRID_W * GRID_H;

/** 0 = right, 1 = down, 2 = left, 3 = up. Opposite of d is (d + 2) & 3. */
export type Dir = 0 | 1 | 2 | 3;
export const DIR_DX: readonly number[] = [1, 0, -1, 0];
export const DIR_DY: readonly number[] = [0, 1, 0, -1];
export const DIR_RIGHT: Dir = 0;
export const DIR_DOWN: Dir = 1;
export const DIR_LEFT: Dir = 2;
export const DIR_UP: Dir = 3;

export function opposite(d: Dir): Dir {
  return ((d + 2) & 3) as Dir;
}

export type Phase = "playing" | "paused" | "gameover";

/**
 * Intents are small integers so the input queue and the pending buffer are
 * typed arrays: 0..3 = turn to that direction, 4 = pause, 5 = restart.
 */
export type Intent = number;
export const INTENT_PAUSE = 4;
export const INTENT_RESTART = 5;
export type IntentKind = "turn" | "pause" | "restart";

export function turnIntent(d: Dir): Intent {
  return d;
}

export function intentKind(i: Intent): IntentKind {
  if (i === INTENT_PAUSE) return "pause";
  if (i === INTENT_RESTART) return "restart";
  return "turn";
}

export function intentDir(i: Intent): Dir {
  return (i & 3) as Dir;
}

/** Turn buffer depth: a fast double-tap is honoured, a mash is dropped. */
export const MAX_PENDING = 3;

/** Initial snake length; the head starts at the centre pointing right. */
export const START_LEN = 3;

export interface State {
  /** The 32-bit seed the run was initialised from (restart re-inits with it). */
  seed: number;
  tick: number;
  dir: Dir;
  /** Queued turns, oldest first. */
  pending: Uint8Array;
  pendingLen: number;
  /** Body cells packed as x + y * GRID_W, head at index 0, capacity CELL_COUNT. */
  body: Uint16Array;
  bodyLen: number;
  foodX: number;
  foodY: number;
  score: number;
  phase: Phase;
  /** xorshift32 state, never zero. */
  rng: number;
  /** Tick of the last eat (-1 before the first one). Drives the combo window. */
  lastEatTick: number;
  /** Current combo multiplier, 1..MAX_COMBO. */
  combo: number;
  /** Current level, 1-based, re-derived from score every tick. */
  level: number;
}

export function packCell(x: number, y: number): number {
  return x + y * GRID_W;
}
export function cellX(c: number): number {
  return c % GRID_W;
}
export function cellY(c: number): number {
  return (c - (c % GRID_W)) / GRID_W;
}

// Effects: what happened this tick, for the presentation layer to consume.
export type EffectKind = "ate" | "grew" | "turned" | "died" | "spawned" | "levelup";
export const EFFECT_ATE = 0;
export const EFFECT_GREW = 1;
export const EFFECT_TURNED = 2;
export const EFFECT_DIED = 3;
export const EFFECT_SPAWNED = 4;
export const EFFECT_LEVELUP = 5;
export const EFFECT_NAMES: readonly EffectKind[] = ["ate", "grew", "turned", "died", "spawned", "levelup"];

export type DeathCause = "wall" | "self";
export const CAUSE_WALL = 0;
export const CAUSE_SELF = 1;

/**
 * Fixed-capacity ring of effects. `kind`/`x`/`y`/`arg` are parallel arrays;
 * `arg` carries the per-kind payload: points for `ate`, the new direction
 * for `turned`, the cause for `died`, the new level for `levelup`.
 * When full, the oldest entry is overwritten. The consumer drains it each
 * frame with `effectAt` and clears it with `resetSink`.
 */
export interface EffectSink {
  readonly cap: number;
  kind: Uint8Array;
  x: Uint8Array;
  y: Uint8Array;
  arg: Int16Array;
  /** Index of the oldest live entry. */
  head: number;
  /** Number of live entries, <= cap. */
  len: number;
  /** Total emitted since the last reset, including evicted ones. */
  dropped: number;
}

export const DEFAULT_SINK_CAP = 32;

export function createSink(cap = DEFAULT_SINK_CAP): EffectSink {
  return {
    cap,
    kind: new Uint8Array(cap),
    x: new Uint8Array(cap),
    y: new Uint8Array(cap),
    arg: new Int16Array(cap),
    head: 0,
    len: 0,
    dropped: 0
  };
}

export function emit(sink: EffectSink, kind: number, x: number, y: number, arg = 0): void {
  let slot: number;
  if (sink.len < sink.cap) {
    slot = (sink.head + sink.len) % sink.cap;
    sink.len++;
  } else {
    slot = sink.head;
    sink.head = (sink.head + 1) % sink.cap;
    sink.dropped++;
  }
  sink.kind[slot] = kind;
  sink.x[slot] = x;
  sink.y[slot] = y;
  sink.arg[slot] = arg;
}

/** Physical slot of the i-th oldest live effect (0 <= i < len). */
export function effectAt(sink: EffectSink, i: number): number {
  return (sink.head + i) % sink.cap;
}

export function resetSink(sink: EffectSink): void {
  sink.head = 0;
  sink.len = 0;
  sink.dropped = 0;
}
