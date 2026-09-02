// Per-level progression. The level is re-derived from score every tick so the
// simulation stays tier-independent: the runtime reads `level` to pick a tick
// interval, but the domain never measures wall-clock.

/** Score thresholds; level N requires score >= LEVEL_SCORES[N-1]. */
export const LEVEL_SCORES: readonly number[] = [0, 150, 400, 800, 1500]
export const MAX_LEVEL: number = LEVEL_SCORES.length // 5
/** Per-level tick interval in ms (L1 is the 120 ms base). Chosen by the runtime. */
export const LEVEL_TICK_MS: readonly number[] = [120, 105, 92, 82, 74]
/** Eating within this many ticks of the previous eat raises the combo. */
export const COMBO_WINDOW_TICKS: number = 6
export const MAX_COMBO: number = 4

/** 1-based level for a score. */
export function levelForScore(score: number): number {
  let lv = 1
  for (let i = 1; i < LEVEL_SCORES.length; i++) {
    const t = LEVEL_SCORES[i]
    if (t !== undefined && score >= t) lv = i + 1
  }
  return lv
}

/** Food value by level: L1-2 apple (+10), L3-4 orange (+20), L5 golden (+40). */
export function foodValueForLevel(level: number): number {
  if (level <= 2) return 10
  if (level <= 4) return 20
  return 40
}

/** Tick interval (ms) for a level; the runtime applies this, the domain ignores it. */
export function tickMsForLevel(level: number): number {
  const idx = Math.max(0, Math.min(level - 1, LEVEL_TICK_MS.length - 1))
  return LEVEL_TICK_MS[idx] ?? 120
}
