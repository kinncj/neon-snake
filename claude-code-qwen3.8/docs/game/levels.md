# Levels, progression, and death cause

Progression lives in the pure domain (`app/domain/levels.ts`, ADR 0003). The level is
**re-derived from the score on every tick** — the runtime reads `level` only to pick a
tick interval; the domain never measures wall-clock, so the simulation stays
tier-independent and replayable.

## Score thresholds

Level `N` requires `score >= LEVEL_SCORES[N-1]`. Level 1 is the start.

| Level | Threshold | Tick interval | Food | Food value |
|---|---|---|---|---|
| 1 | 0 | 120 ms | apple | +10 |
| 2 | 150 | 105 ms | apple | +10 |
| 3 | 400 | 92 ms | orange | +20 |
| 4 | 800 | 82 ms | orange | +20 |
| 5 | 1500 | 74 ms | golden | +40 |

`LEVEL_SCORES = [0, 150, 400, 800, 1500]`, `MAX_LEVEL = 5`. Past the top threshold the
HUD reads `MAX` (the score keeps counting; only the level plateaus at 5).

`levelForScore(score)` walks the thresholds and returns the 1-based level.
`tickMsForLevel(level)` maps level → interval, clamped so an out-of-range level still
resolves to a valid interval (L1's 120 ms base). The runtime (`FixedTimestepLoop`)
re-ticks at the new interval when the level changes.

## Combo

A **combo** rewards eating quickly. Eating within `COMBO_WINDOW_TICKS = 6` ticks of the
previous eat raises the combo by one, capped at `MAX_COMBO = 4`. The multiplier is
`×1..×4`: the food's base value is multiplied by the combo, so a golden apple eaten at
combo 4 is worth `40 × 4 = 160` in one bite. The combo decays (resets) when an eat
lands outside the window. The combo also drives the SFX — a chomp becomes a brighter
**coin** on a combo (see `audio.md`).

## Death cause

A death resolves by **cause** so the presentation and the SFX can respond differently
(ADR 0003):

- **`wall`** — the head steps off the playfield. FX: sparks fly off the wall, a
  hard wall-local flash, a radial shockwave, and a strong shake; SFX: a low **boom**.
- **`self`** — the head bites its own body. FX: a wet "blood" splatter from the head,
  a smaller shake and a soft full-frame flash; SFX: a wet **splat**.

Both causes end by dissolving into the game-over panel, with the game-over **sting**
layered under the cause-specific hit. The cause is emitted in the death `Effect` and
read read-only by the FX layer and the audio — neither mutates domain state.

## Invariants

- The level, combo, and cause are **pure functions of the tick's inputs** (score, eat
  timing, collision geometry). There is no wall-clock, no `Math.random` in the level
  path, and no delta-time arithmetic — the sim advances one fixed tick at a time.
- `tickMsForLevel` / `foodValueForLevel` / `levelForScore` clamp out-of-range input, so
  a tampered or mid-flight `level` never yields `undefined` (unit-tested in
  `tests/unit/levels.test.ts`).
