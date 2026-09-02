// Pure domain: constants and types for the snake simulation.
//
// This is the contract boundary. Nothing in app/domain touches the DOM,
// timers, Math.random, Date, audio, or rendering — the eslint domain block
// (eslint.config.js) enforces that and fails the build, not just the review.
//
// Memory model: all state is preallocated once at init() and mutated in
// place for the life of the record. `body` and `pending` are fixed
// capacity; growth bumps `bodyLen`, it never pushes. A tick must therefore
// never allocate.

export const GRID_W = 32;
export const GRID_H = 30;
export const CELL_PX = 8; // 32 * 8 = 256 px wide, 30 * 8 = 240 px tall
export const FIELD_W = GRID_W * CELL_PX;
export const FIELD_H = GRID_H * CELL_PX;
export const BODY_CAP = GRID_W * GRID_H;
export const TICK_MS = 120; // base interval; levels.ts picks per-level values
export const FOOD_VALUE = 10; // base apple value, scaled by the combo
export const MAX_PENDING = 2;

export type Dir = 0 | 1 | 2 | 3; // 0=up, 1=right, 2=down, 3=left
export type Phase = "playing" | "paused" | "gameover";

/**
 * Fruit kinds. The kind a spawn gets is fixed by the current level
 * (levels.ts), so the fruit mix is a pure function of progression, not of
 * the RNG.
 */
export type FoodKind = "apple" | "orange" | "golden";

/** Why a "died" effect fired; every other effect carries "none". */
export type Cause = "none" | "wall" | "self";

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export interface FoodCell extends Cell {
  readonly kind: FoodKind;
}

/**
 * The entire simulation in one record. `readonly` is the public contract —
 * renderers and audio only read it. The engine (step.ts) mutates the record
 * in place through an explicit mutable view and always returns the same
 * reference.
 */
export interface State {
  readonly tick: number;
  readonly dir: Dir;
  /** 0..MAX_PENDING; only the first pendingLen entries are valid. */
  readonly pendingLen: number;
  /** Fixed length MAX_PENDING. */
  readonly pending: readonly Dir[];
  readonly bodyLen: number;
  /** Fixed length BODY_CAP; index 0 is always the head. */
  readonly body: readonly Cell[];
  readonly food: FoodCell;
  readonly score: number;
  /** 1..MAX_LEVEL, re-derived from score every tick. */
  readonly level: number;
  /** Current multiplier; 0 until the first eat, then 1..MAX_COMBO. */
  readonly combo: number;
  /** Tick of the previous eat; the combo window is measured from it. */
  readonly lastEatTick: number;
  /** Best score this record has reached (kept across restarts). */
  readonly best: number;
  readonly phase: Phase;
  /** xorshift32 state, uint32. */
  readonly rng: number;
}

export type Intent =
  | { readonly kind: "turn"; readonly dir: Dir }
  | { readonly kind: "pause" }
  | { readonly kind: "restart" };

export type EffectKind =
  | "ate"
  | "grew"
  | "turned"
  | "died"
  | "spawned"
  | "levelup";

/** One emitted event; the sink slots are preallocated and reused. */
export interface Effect {
  readonly kind: EffectKind;
  readonly x: number;
  readonly y: number;
  readonly cause: Cause;
}

/**
 * Preallocated effect sink. step() writes into items[0..count) and never
 * allocates; the consumer resets count = 0 once per frame.
 */
export interface EffectSink {
  /** Fixed capacity, mutable slots. */
  readonly items: Effect[];
  count: number;
}
