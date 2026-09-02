# ADR 0003 — Level progression, combo scoring, and death causes live in the domain

Date: 2026-09-02 (UTC, phase 2, step 17)

## Status

Accepted.

## Context

Phase 2 adds arcade framing: levels, a combo multiplier, best-score tracking,
and distinct death causes (wall vs. self). The temptation is to hang these off
the runtime (HUD counters, a speed multiplier in the loop, an enum the renderer
infers). That scatters game rules across presentation and makes them
un-replayable: a replay harness that re-runs the engine would silently drift
from the recorded run the moment scoring or speed-up moved out of `step()`.

The engine is already a pure function of (seed, intents) and is the single
source of truth for anything observable in a recorded log. Everything the
player can *see happen* therefore belongs where the log can see it too.

## Decision

- `app/domain/levels.ts` owns the entire progression system as **clamped
  table lookups** (score → level, level → tick interval, level → fruit kind,
  fruit kind → base value). No RNG, no wall clock, no I/O.
- `State` carries `food.kind`, `level`, `combo`, `lastEatTick`, and `best`.
  Level is **re-derived from score every eat**, never incremented ad hoc, so
  the same intent log always lands on the same level.
- Combo: eating within `COMBO_WINDOW_TICKS` (6) of the previous eat raises the
  multiplier (capped at `MAX_COMBO = 4`); a longer gap resets it to 1. Gained
  score = `foodValueForKind(kind) * combo`.
- `Effect` carries `cause: "none" | "wall" | "self"`. The domain reports *what
  happened*; the presentation layer decides *how it looks and sounds*
  (explosion vs. blood, boom vs. splat). Renderers and audio branch on the
  emitted effect, never on state alone.
- `reinit` keeps `best` (a run record, not run state); `init` starts at 0.
- The fixed loop gains `setTickMs(ms)`; `main.ts` follows
  `tickMsForLevel(state.level)` after each tick. The loop itself knows nothing
  about levels (SRP): it just obeys the interval it is given.
- The replay hash's canonical serialisation covers the new fields, so any
  engine change to progression re-records the fixture hash on purpose
  (recorded value: `2e58d3c2` for `tests/fixtures/run-a.log`).

## Consequences

- Speed-ups, fruit mix, and scoring are replayable and unit-testable without
  a browser (see `tests/unit/levels.test.ts`,
  `tests/unit/progression.test.ts`).
- Adding a level = appending a table row (OCP); nothing outside `levels.ts`
  changes unless the tables run out.
- `best` lives in `State`, so the replay fixture (seeded with best = 0) is
  unaffected by whatever high score a real player holds; persistence
  (localStorage) is an adapter concern wired at boot, not domain state.
- One deliberate asymmetry: effects carry `cause` but the hash does not cover
  effects — causes are *derivable* from the log (position + phase), so
  skipping them keeps the hash stable.
