# ADR 0003 — Levels, combo, and death cause (progression re-derived each tick)

- **Status:** accepted
- **Date:** 2026-09-03
- **Area:** domain / progression (`app/domain/levels.ts`, `step.ts`)

## Context

Phase 2 turns the single-pace snake into an arcade progression: it should get
faster as the player scores, reward eating in quick succession, and let the
presentation layer react differently to a wall death than a self-bite. All of
this must land **inside the pure domain** and preserve the two invariants that
the whole build is built on:

- **Tier-independence.** The simulation must evolve identically regardless of the
  quality tier, because the per-level tick interval (`LEVEL_TICK_MS`) is a *config
  value the runtime chooses* — the domain never measures wall-clock. If the
  progression depended on elapsed real time, two tiers stepping the same seed at
  different tick rates would diverge, and the replay hash would no longer be
  tier-independent.
- **Determinism / replay.** A fixed seed stepped by a fixed intent log must
  reproduce the same state (and FNV hash) on independent instances, across runs,
  at every tier.

The progression has to be driven by something the domain already owns and that is
tick-deterministic. That something is the **score**.

## Decision

**Progression is a pure function of the score, re-derived every tick.**

- **Level.** `LEVEL_SCORES = [0, 150, 400, 800, 1500]` → `MAX_LEVEL = 5`. The level
  is `levelForScore(score)` (the highest 1-based index whose threshold is met).
  Each tick, `step` **re-derives** `state.level` from the current score rather than
  treating `level` as an independently-stored counter that gets bumped on a
  crossing. Because the level is recomputed from the score every tick, it can
  never desynchronise from the score, and since the score only changes on the
  tick-deterministic eat event, the level is identical at any given score no matter
  which tier (or tick rate) produced it.
- **Per-level tick interval.** `LEVEL_TICK_MS = [120, 105, 92, 82, 74]` (L1 is the
  120 ms base). This is read by the **runtime** (`loop.tickMs =
  tickMsForLevel(state.level)`), never by the domain. The domain only exposes the
  level; the timing is a presentation/runtime concern. This is what keeps the
  "get faster" feel without putting a clock in the domain.
- **Combo.** Eating within `COMBO_WINDOW_TICKS = 6` of the previous eat raises the
  multiplier by one, capped at `MAX_COMBO = 4`; a gap longer than the window resets
  it to 1. The multiplier is applied to the per-level food value, so a quick
  streak is worth up to 4× the base value. State carries `combo` and `lastEatTick`
  (the tick of the previous eat, `-1` before the first).
- **Food by level.** L1–2 apple (+10), L3–4 orange (+20), L5 golden (+40)
  (`foodValueForLevel`). The score gain on an eat is
  `foodValueForLevel(level) * combo`.
- **Level-up event.** When an eat pushes the score across a threshold, the level
  rises and a `levelup` effect is emitted carrying the new (1-based) level as its
  `value`. The presentation uses this to re-tint the scene and play a jingle.
- **Death cause.** `died` effects carry a `cause` — `"wall"` or `"self"` — so the
  presentation layer can play distinct death FX (a rightward wall spark + boom
  versus a self-bite chomp + splat). The cause is decided at the collision site
  (`step` knows which collision it hit) and rides the effect out to the observer.

**Why re-derived rather than stored-and-bumped.** Storing `level` as a counter and
incrementing it when a threshold is crossed would introduce a *second* source of
truth that can drift from the score (an off-by-one, a missed crossing, a restart
that forgets to reset it). Re-deriving `level = levelForScore(score)` each tick
makes the score the single source of truth, makes the level a trivial pure
function, and costs one small scan of the threshold table. It is also the only
form that is obviously correct under the tier-independence and replay rules.

## Hash and tier-independence

The canonical state hash (FNV-1a) feeds the load-bearing, tick-deterministic
fields: tick, dir, pending queue, bodyLen, body (x,y), food, score, phase, rng.
The derived progression fields (`level`, `combo`, `lastEatTick`) and the
client-side fields (`highScore`, `seed`) are **excluded** from the hash because
they are functionally determined by the included fields (level is a pure function
of score; combo/lastEatTick are determined by the eat history that score and tick
trace; a corruption of `lastEatTick` would surface on the next eat's score, which
*is* hashed). Excluding them keeps the hash canonical and — because none of the
included fields depends on wall-clock or tier — **identical across quality tiers
and independent engine instances**, which is exactly what the replay fixture
(`tests/fixtures/run-a.log`) asserts.

## Consequences

**Positive**

- Progression is tier-independent by construction: two engines at different tiers
  that reach the same score have the same level and the same upcoming tick
  interval, and a replay hashes identically at every tier.
- The domain stays pure: no clock, no `Math.random`, no timers. The tick interval
  lives in `levels.ts` as data and is consumed only by the runtime.
- The presentation layer gets clean, cause-tagged events (`levelup`, `died` with a
  cause) and does not have to reverse-engineer the reason for a state change.

**Negative / accepted costs**

- `levelForScore` is a small linear scan of a 5-entry table, run once per tick.
  Negligible, and it keeps the code simple and allocation-free.
- The `levelup` is detected by comparing the post-eat level to the pre-eat level
  (`nl > s.level`); because the level is re-derived at the top of the tick and only
  rises on an eat, this fires exactly once per crossing.

## Alternatives considered

- **Time-based progression (level up after N seconds).** Rejected: breaks
  tier-independence and replay — the tick rate differs by tier, so real-time
  progression would make the sim depend on wall-clock, which the domain is not
  allowed to see.
- **Store `level` as a counter and bump it on a threshold crossing.** Rejected: a
  second source of truth that can drift from the score and must be kept in sync
  across eat/restart; re-derivation is simpler and cannot desynchronise.
- **Drive the combo off a wall-clock timer.** Rejected for the same reason as
  time-based progression; the combo window is measured in *ticks*
  (`COMBO_WINDOW_TICKS`), which is tick-deterministic.
