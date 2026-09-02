export const GRID_W = 32;
export const GRID_H = 30;
export const CELL_PX = 8;          // 32*8 = 256, 30*8 = 240
export const TICK_MS = 120;        // base interval; levels.ts scales it down
export const FOOD_VALUE = 10;      // base apple value (multiplied by combo)
export const MAX_PENDING = 2;

export type Dir = 0 | 1 | 2 | 3;   // 0=up 1=right 2=down 3=left
export type Phase = "playing" | "paused" | "gameover";

/**
 * Fruit kinds. The kind a spawn gets is determined by the current level
 * (levels.ts) so the simulation stays a pure function of (seed, intents).
 * apple  — standard, low value
 * orange — mid-level, higher value
 * golden — top level, highest value
 */
export type FoodKind = "apple" | "orange" | "golden";

/** Why a "died" effect fired; every other effect carries "none". */
export type Cause = "none" | "wall" | "self";

export interface Cell { readonly x: number; readonly y: number }
export interface FoodCell extends Cell { readonly kind: FoodKind }

export interface State {
  readonly tick: number;
  readonly dir: Dir;
  readonly pendingLen: number;           // 0..MAX_PENDING
  readonly pending: readonly Dir[];      // fixed length MAX_PENDING, only first pendingLen valid
  readonly bodyLen: number;
  readonly body: readonly Cell[];        // fixed length GRID_W*GRID_H, head at index 0
  readonly food: FoodCell;
  readonly score: number;
  readonly level: number;                // 1..MAX_LEVEL, derived from score each tick
  readonly combo: number;                // current multiplier, 0 until first eat
  readonly lastEatTick: number;          // tick of the previous eat (combo window)
  readonly best: number;                 // best score this state has reached
  readonly phase: Phase;
  readonly rng: number;                  // uint32
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

export interface Effect {
  readonly kind: EffectKind;
  readonly x: number;
  readonly y: number;
  readonly cause: Cause;
}

/** Preallocated sink. step() writes here; never allocates. */
export interface EffectSink {
  readonly items: Effect[];              // fixed capacity, mutable slots
  count: number;                         // reset by the consumer each frame
}
