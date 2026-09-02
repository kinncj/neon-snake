# ADR 0003 — Levels, combo, death cause

## Status

Accepted.

## Context

Phase 1 shipped a single-speed snake with a flat 10 points per food. The
arcade expansion needs progression (speed, food, look and music that change
as the player improves), a reward for aggressive play, and distinct death
presentation for hitting a wall versus biting yourself. All of it must stay
deterministic and tier-independent: a replayed input log has to reach the
same hash at every quality tier, and the domain may not measure time.

## Decision

**Progression is a pure function of the score, re-derived every tick.**

- `LEVEL_SCORES = [0, 150, 400, 800, 1500]`, so `MAX_LEVEL = 5`.
  `levelForScore(score)` is evaluated at the end of every `step()`; when it
  changes, `state.level` is updated and a `levelup` effect carries the new
  level. There is no level counter that could drift from the score.
- **Speed is a runtime config value**, not domain behaviour:
  `LEVEL_TICK_MS = [120, 105, 92, 82, 74]` lives in `levels.ts` and the
  runtime loop reads `tickMsForLevel(state.level)` each frame. The domain
  still advances exactly one tick per `step()` and never sees wall-clock.
- **Food by level**: L1–2 apple (+10), L3–4 orange (+20), L5 golden (+40).
  Both the value (domain) and the sprite (presentation) derive from the
  level, so they can never disagree.
- **Combo**: eating within `COMBO_WINDOW_TICKS = 6` ticks of the previous
  eat raises the multiplier by one, capped at `MAX_COMBO = 4`; a longer gap
  resets it to ×1. The multiplier applies to the eat that extends the chain
  and rides in the `ate` payload, so the HUD can show `+N` without
  recomputing it. Ticks, not milliseconds, define the window, so the combo
  is identical at every level speed and tier.
- **Death cause**: the `died` effect carries `cause` (`wall` | `self`) so
  the FX and audio layers can present a wall crash (sparks, shake, local
  flash, boom) differently from a self-bite (chomp, blood, splat). The
  domain's collision rule is unchanged.
- Hash coverage: `combo` and `lastEatTick` are part of the canonical
  serialisation because they feed the next tick's scoring.

## Consequences

- The replay fixture recorded before this change still replays (intents do
  not depend on score); only the pinned hash changed, from `d0f10c02` to
  `52b1ba03`.
- Level-ups can only happen on an eat, which makes the level-up effect a
  natural place for the presentation layer to re-tint and crossfade.
- A restart resets level, combo and speed together because they all derive
  from the reset score.
