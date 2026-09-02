# Levels, combo, and scoring

Player-facing progression, and where it is enforced. All numbers come from
`app/domain/levels.ts` (single source of truth) — this page is the doc, the
tables are the law.

## Levels

The snake speeds up as you climb. Level is a pure function of score:

| Level | Score needed | Tick interval | Fruit       | Pace      |
| ----- | ------------ | ------------- | ----------- | --------- |
| 1     | 0            | 120 ms        | apple       | baseline  |
| 2     | 150          | 105 ms        | apple       | a bit hot |
| 3     | 400          | 92 ms         | **orange**  | serious   |
| 4     | 800          | 82 ms         | orange      | fast      |
| 5     | 1500         | 74 ms         | **golden**  | max speed |

- Ticks are integers and strictly decreasing; 74 ms is the hard floor.
- The level does not change mid-tick — it is re-derived when score changes
  (i.e. when you eat). The simulation advances one fixed tick at a time;
  only the *interval* changes, never the tick's contents.

## Fruit

| Fruit  | Levels | Base value |
| ------ | ------ | ---------- |
| 🍎 apple   | 1–2    | 10         |
| 🍊 orange  | 3–4    | 20         |
| ⭐ golden  | 5      | 40         |

Fruit kind is decided by **level**, not the RNG: the RNG picks *where* fruit
spawns, the progression table decides *what* it is. Replays therefore spawn
identical fruit at identical cells regardless of how fast the machine runs.

## Combo

Eat quickly, score more:

- Eat within **6 ticks** (~0.7 s at level 1 pace) of your previous eat and
  the multiplier climbs by one.
- The multiplier caps at **×4**.
- A longer gap resets it to ×1.
- Points per eat = `base value × combo`.

Worked example: apple, apple, apple back-to-back = 10 + 20 + 30 = 60.
At level 3+ the same chain on oranges is 20 + 40 + 60 = 120 — progression
and combo compound, which is why the level thresholds are spaced out.

## Best score

- `state.best` is the highest score this state has ever reached; it is
  updated on every eat and on death.
- `reinit` (restart) keeps `best`; a fresh `init` starts from 0.
- Persistence to localStorage is a runtime adapter (step 19), so the domain
  stays pure and the replay fixture stays deterministic.

## Death causes

`died` effects carry `cause`:

- `wall` — hit a wall. Presentation: explosion, sparks, screen shake, boom.
- `self` — bit yourself. Presentation: blood spray, chomp, red flash.
- `none` — everything else. Effects that never die still carry it so the
  shape stays uniform.

The domain never names the presentation; adapters listen for `died` +
`cause` and do their thing (ADR 0003).
