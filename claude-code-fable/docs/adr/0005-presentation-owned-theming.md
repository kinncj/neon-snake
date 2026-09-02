# ADR 0005 — Presentation-owned theming

## Status

Accepted.

## Context

Each of the five levels should feel like a different room: a different neon
palette for the background, grid, snake body, head, accent, HUD and
overlays, with a visible re-tint when the level changes. The domain is a
pure integer simulation and must not know about colours, and the replay
hash must not change because a palette did.

## Decision

- **Colours live in the presentation layer** (`app/adapters/render/theme.ts`).
  The domain exposes only `state.level`; `themeForLevel(level)` maps it to
  one of five `Theme` records (`bg`, `grid`, `body`, `bodyShade`, `head`,
  `accent`). The non-themed base colours (fruit, eye, stem, leaf, text)
  stay constant so food remains recognisable across levels.

  | Level | Theme | Accent |
  |---|---|---|
  | 1 | midnight-cyan | `#00e5ff` |
  | 2 | neon-magenta | `#ff2e88` |
  | 3 | electric-violet | `#9d6bff` |
  | 4 | tokyo-sunset | `#ff7849` |
  | 5 | golden-hour | `#ffd166` |

- **One live palette object.** `createThemeState` allocates a single
  `Palette`; `updateTheme(ts, level, dt)` rewrites its fields in place each
  frame. A level change starts a 650 ms smoothstep re-tint from the current
  mix to the new theme, so a mid-transition level jump does not snap. Both
  renderers (the 2D framebuffer and the Phaser layer) read the same palette
  object, so they can never disagree on a frame.
- **HUD and overlays follow the accent** through one CSS custom property
  (`--accent`) set from the same palette, so the DOM re-tints with the
  canvas.
- **The domain stays theme-agnostic.** No colour, theme name or level look
  is serialised; the replay hash is identical before and after this ADR.

## Consequences

- Adding or editing a theme is a one-file change with no domain impact and
  no test-fixture churn.
- The e2e theme test reads the 2D framebuffer's background pixel before and
  after a level-up and checks that it settles on the new theme's `bg`.
- Because the transition is time-based in the adapter (not tick-based in
  the domain), a paused game finishes its re-tint; that is the intended
  presentation behaviour.
