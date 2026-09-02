/**
 * Score-driven progression. The level is a pure function of the score and
 * is re-derived every tick, so it never depends on frame pacing or tier.
 * The per-level tick interval is a config value the runtime reads; the
 * domain itself never measures time.
 */
export const LEVEL_SCORES: readonly number[] = [0, 150, 400, 800, 1500];
export const MAX_LEVEL = LEVEL_SCORES.length; // 5
export const LEVEL_TICK_MS: readonly number[] = [120, 105, 92, 82, 74];

/** Eating within this many ticks of the previous eat raises the combo. */
export const COMBO_WINDOW_TICKS = 6;
export const MAX_COMBO = 4;

export type FoodKind = "apple" | "orange" | "golden";
export const FOOD_VALUES: Record<FoodKind, number> = { apple: 10, orange: 20, golden: 40 };

/** 1-based level for a score. */
export function levelForScore(score: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_SCORES.length; i++) if (score >= LEVEL_SCORES[i]!) level = i + 1;
  return level;
}

/** Tick interval (ms) for a 1-based level. */
export function tickMsForLevel(level: number): number {
  const i = Math.min(Math.max(level, 1), MAX_LEVEL) - 1;
  return LEVEL_TICK_MS[i]!;
}

/** Food type by level: L1–2 apple, L3–4 orange, L5 golden. */
export function foodForLevel(level: number): FoodKind {
  if (level >= MAX_LEVEL) return "golden";
  if (level >= 3) return "orange";
  return "apple";
}

export function foodValueForLevel(level: number): number {
  return FOOD_VALUES[foodForLevel(level)];
}

/** Next combo multiplier given the ticks since the last eat. */
export function nextCombo(combo: number, ticksSinceLastEat: number): number {
  if (ticksSinceLastEat < 0) return 1;
  if (ticksSinceLastEat <= COMBO_WINDOW_TICKS) return Math.min(MAX_COMBO, combo + 1);
  return 1;
}

/** Score threshold for the next level, or null at MAX. */
export function nextThreshold(level: number): number | null {
  return level >= MAX_LEVEL ? null : LEVEL_SCORES[level]!;
}
