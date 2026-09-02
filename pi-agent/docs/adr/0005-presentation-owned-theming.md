# ADR 0005 — Presentation-owned per-level theming

Date: 2026-09-02 (UTC, phase 2, step 20)

## Status

Accepted.

## Context

Levels change gameplay (speed, food kind, value) in the domain, but the user
expectation for phase 2 is that a level-up is also a *visual* event: the
scene re-tints, the HUD accent shifts, the whole room changes mood. The
question is where the colour story lives.

## Decision

**The domain stays colour-agnostic. Theming is a presentation adapter.**

- `state.level` is the only domain fact; it is an integer.
- `app/adapters/render/theme.ts` owns the palette table and a `ThemeMixer`
  that lerps between palettes. The framebuffer and the GL composite both
  read the live (possibly mid-transition) colours.
- The HUD accent is a registered CSS custom property so the DOM side
  animates in lock-step with the canvas side.

## Consequences

- **Replays are deterministic and portable.** A replay at level 3 renders
  identically to the original run because the level derives from score and
  the theme derives from the level. No colour state is stored in the domain
  or the replay.
- **Both tiers animate in lock-step.** The 2D framebuffer and the GL
  composite consume the same live colour set, so a theme shift looks the
  same at low and ultra (modulo the passes each tier runs).
- **Steady state is allocation-free.** Colours are preallocated arrays
  mutated in place; CSS strings are cached and rebuilt only during the
  ~40-frame transition window. The DOM is touched only while a shift is
  live.
- **Food never recolors.** It is the fixed target the player hunts, so it
  is held constant across themes to stay readable.

## Alternatives considered

- **Theme in the domain** (store a palette id on state). Rejected: it
  couples the pure engine to a presentation concern and pollutes the replay
  hash with a non-gameplay field.
- **Hard cut, no transition.** Rejected: a level-up that doesn't *feel*
  like an event misses the point of the feature.
- **CSS-only theming (variables everywhere, canvas reads CSS vars).**
  Rejected: the canvas is the dominant surface; reading CSS vars per cell
  per frame would be slow and would desync the 2D and GL paths.
