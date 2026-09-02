/**
 * Pure progression tables. No I/O, no time, no RNG: the whole level system
 * is a set of clamped table lookups so it can be unit-tested and replayed.
 *
 * Design notes:
 * - Levels are derived from score, never incremented ad hoc — replaying the
 *   same intent log over the same seed must land on the same level.
 * - Tick intervals are integers and strictly decreasing: the game gets
 *   faster as you climb, with a hard floor so the endgame stays playable.
 * - Food kind is a function of level, so higher fruit appears only after
 *   progression (see foodValueForKind for the value table).
 *
 * Add a new level by appending to the two tables and, if needed, extending
 * foodKindForLevel — nothing outside this file needs to change (OCP).
 */
import type { FoodKind } from "./types";

export const MAX_LEVEL = 5;

/** LEVEL_SCORES[i] is the minimum score required to be on level i+1. */
export const LEVEL_SCORES: readonly number[] = [0, 150, 400, 800, 1500];

/** Fixed simulation interval per level, in ms. L1 is the base TICK_MS. */
export const LEVEL_TICK_MS: readonly number[] = [120, 105, 92, 82, 74];

/**
 * Combo: eating within COMBO_WINDOW_TICKS of the previous eat raises the
 * multiplier by one (capped at MAX_COMBO); a longer gap resets it to 1.
 * Score gained per eat = foodValueForKind(kind) * combo.
 */
export const MAX_COMBO = 4;
export const COMBO_WINDOW_TICKS = 6;

function clampLevel(level: number): number {
  return Math.min(Math.max(level, 1), MAX_LEVEL);
}

/** Level (1..MAX_LEVEL) for a score. Score thresholds are monotonic. */
export function levelForScore(score: number): number {
  let lvl = 1;
  for (let i = LEVEL_SCORES.length - 1; i >= 0; i--) {
    if (score >= LEVEL_SCORES[i]!) {
      lvl = i + 1;
      break;
    }
  }
  return clampLevel(lvl);
}

/** Simulation interval (ms) for a level. Monotonically decreasing. */
export function tickMsForLevel(level: number): number {
  return LEVEL_TICK_MS[clampLevel(level) - 1]!;
}

/** Fruit kind spawned at a level: 1-2 apple, 3-4 orange, 5 golden. */
export function foodKindForLevel(level: number): FoodKind {
  const l = clampLevel(level);
  if (l >= 5) return "golden";
  if (l >= 3) return "orange";
  return "apple";
}

/** Base value of a fruit before the combo multiplier. */
export function foodValueForKind(kind: FoodKind): number {
  switch (kind) {
    case "golden":
      return 40;
    case "orange":
      return 20;
    case "apple":
      return 10;
  }
}

/** True when `level` exceeds the highest threshold (for "MAX" UI states). */
export function isMaxLevel(level: number): boolean {
  return clampLevel(level) >= MAX_LEVEL;
}
