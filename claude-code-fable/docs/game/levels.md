# Levels, speed, food and combo

Progression is a pure function of the score, re-derived every tick by the
domain (`app/domain/levels.ts`, ADR 0003). Nothing about it depends on
frame rate or quality tier.

| Level | Score to reach | Tick | Food | Points | Theme | Song |
|---|---|---|---|---|---|---|
| 1 | 0 | 120 ms | apple | 10 | midnight-cyan | cozy-bedroom (70 bpm) |
| 2 | 150 | 105 ms | apple | 10 | neon-magenta | window-seat (74 bpm) |
| 3 | 400 | 92 ms | orange | 20 | electric-violet | rainy-train (78 bpm) |
| 4 | 800 | 82 ms | orange | 20 | tokyo-sunset | park-bench (82 bpm) |
| 5 (MAX) | 1500 | 74 ms | golden | 40 | golden-hour | skyline-view (86 bpm) |

## Combo

Eating again within **6 ticks** of the previous eat raises the multiplier
by one, up to **×4**; a longer gap resets it to ×1. The multiplier applies
to the eat that extends the chain, so a perfect chain at level 5 scores
40, 80, 120, 160, 160, … The window is counted in ticks, so it is the same
challenge at every speed.

## What changes on a level-up

- The tick interval shortens (the runtime reads `tickMsForLevel`).
- The food sprite and value change (domain and presentation both derive
  from the level, so they cannot disagree).
- The whole scene re-tints to the level's palette over 650 ms
  (`docs/game/themes.md`).
- The music crossfades to the level's song over 250 ms
  (`docs/game/audio.md`).
- A level-up jingle plays and a banner shows the new level (or **MAX**).

A restart resets the score, and therefore level, speed, theme and song,
in one move.
