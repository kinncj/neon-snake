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
- `app/adapters/render/theme.ts` owns the palette table (five neon themes)
  and a `ThemeMixer` that eases between palettes over ~600 ms. The 2D
  framebuffer reads the live (possibly mid-transition) colours each frame
  via its `setPalette` hook.
- The HUD accent is a CSS custom property (`--neon` on `#screen`) so the DOM
  side animates in lock-step with the canvas side. A live shift also writes
  `screen.dataset.level` as a cheap DOM hook for the theme e2e gate.
- **Level 1 is the base 2D scene established in step 10** (bg `#12121c`,
  grid `#24283b`, body `#00e5ff`, head `#c0caf5`). Levels 2–5 shift the whole
  scene toward "golden hour". The per-level *accent* matches the spec's
  palette table (`#00e5ff` / `#ff2e88` / `#9d6bff` / `#ff7849` / `#ffd166`).
- Food never recolors: the 2D food keeps its fixed per-kind colours so it
  stays a readable target across themes (the theme's `food` channel is
  reserved for the FX halo).

## Consequences

- **Replays are deterministic and portable.** A replay at level 3 renders
  identically to the original run because the level derives from score and
  the theme derives from the level. No colour state is stored in the domain
  or the replay (the replay hash is unaffected).
- **Steady state is allocation-free.** Colours are preallocated arrays
  mutated in place; CSS strings are cached and rebuilt only during the
  ~40-frame transition window. The DOM and the framebuffer palette are
  touched only while a shift is live.
- **The screen-space FX layer consumes the theme at the step-24 migration.**
  The step-14 hand-rolled WebGL2 FX is the precursor; once it is swapped for
  the Phaser 4 compositor (step 24) the same live colour set feeds the GL
  path, so the 2D and GL surfaces re-tint in lock-step.

## Alternatives considered

- **Theme in the domain** (store a palette id on state). Rejected: it
  couples the pure engine to a presentation concern and pollutes the replay
  hash with a non-gameplay field.
- **Hard cut, no transition.** Rejected: a level-up that doesn't *feel*
  like an event misses the point of the feature.
- **CSS-only theming (variables everywhere, canvas reads CSS vars).**
  Rejected: the canvas is the dominant surface; reading CSS vars per cell
  per frame would be slow and would desync the 2D and GL paths.
