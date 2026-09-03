# ADR 0005 — Presentation-owned theming (per-level neon palettes)

- **Status:** accepted
- **Date:** 2026-09-03
- **Area:** presentation / theming (`app/adapters/render/theme.ts`)

## Context

Phase 2 introduces five levels. The spec wants each level to have its own neon
palette (background, grid, snake body, snake head, accent) and a level-up to
**re-tint the whole scene** — grid, body, head, accent, and HUD — settling on the
new palette. Two constraints shape where colours may live:

- **The domain stays theme-agnostic.** Colours are a pure presentation concern.
  `app/domain/**` must not know about, store, or import any palette — it reasons
  only about score and level, never about what things look like.
- **Both renderers need the same palette.** The 2D framebuffer (ground truth) and
  the Phaser FX engine both draw the snake, the grid, and the particle FX. They
  must agree on the colours, so the palette has one shared home in the
  presentation layer.

The domain already emits a `levelup` effect and re-derives `state.level` from the
score every tick (ADR 0003). The presentation can therefore key the palette off
`state.level` with no new plumbing.

## Decision

**Colours live entirely in `app/adapters/render/theme.ts`, a fixed table of five
`Theme` records — one per level.** The domain has no colour fields and no import
of `theme.ts`.

- **The table.** L1 midnight-cyan `#00e5ff`, L2 neon-magenta `#ff2e88`,
  L3 electric-violet `#9d6bff`, L4 tokyo-sunset `#ff7849`, L5 golden-hour
  `#ffd166` (the spec's per-level accents). Each `Theme` carries
  `palette: { bg, grid, body, head, accent, food }`; the `head` is drawn in the
  level's accent so the head pops against the body.
- **Selection.** `themeForLevel(level)` returns the 1-based theme, **clamped** to
  `[1, 5]` — an out-of-range level (0, negative, or above the top) still resolves
  to a valid palette rather than `undefined`.
- **Re-tint is per-frame, not an event.** Every render frame reads
  `themeForLevel(state.level).palette` (the 2D composite, the FX engine, and the
  HUD accent all do). Because `state.level` is re-derived from the score each
  tick, the frame *after* a level-up reads the new palette automatically — the
  whole scene re-tints and settles on the new palette with no explicit "re-tint"
  call. The FX accent colours (the `ate` / `levelup` / `died` particle bursts)
  are likewise derived from the current palette, so the effects stay on-theme.

**Why per-frame read rather than an explicit re-tint handler.** The level-up effect
is already consumed by the FX (a particle pulse). Keying the palette off
`state.level` each frame makes the re-tint a *consequence* of reading the current
level, not a side effect to schedule. There is no "current palette" variable to
keep in sync — the level (a pure function of the score, ADR 0003) is the single
source of truth, and the palette is a pure function of the level.

## Consequences

**Positive**

- The domain stays theme-agnostic: no colour fields, no `theme.ts` import, no
  coupling of the pure sim to a visual concern.
- Both renderers share one palette source, so the 2D ground truth and the FX
  layer can never disagree on the colours.
- The level-up re-tint is free and self-correcting (a per-frame read keyed off a
  re-derived level), with no event ordering to get right and no palette state to
  drift.
- Clamping guarantees a valid palette for any level value the state could hold.

**Negative / accepted costs**

- The palette is looked up each frame (a small bounded array index). Negligible,
  and it keeps the re-tint allocation-free.
- The colours are hard-coded in the presentation table rather than loaded from
  data. That is intentional — the five palettes are a fixed design decision, not
  runtime configuration.

## Alternatives considered

- **Colour fields in the domain or config, passed out.** Rejected: couples the
  pure domain to a presentation concern and would leak palette data into the
  state the FNV hash covers.
- **An explicit "re-tint on `levelup`" handler that swaps a global current-palette
  object.** Rejected: a second source of truth (the palette variable) that must be
  kept in sync with `state.level`, and a side effect to schedule; the per-frame
  read keyed off the level achieves the same result with a single source of truth.
- **Per-palette assets (textures / images).** Rejected: violates the procedural,
  no-asset-bytes ethos and the ≤ 500 KB budget; flat neon colours are enough for
  the look.
