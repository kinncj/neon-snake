# Per-level neon themes

The game visibly shifts its colour story as the player climbs. The domain
knows only `state.level` (an integer); the *presentation* maps that integer
to a palette and animates between them. This keeps the engine pure and
replayable — a replay at level 3 looks exactly like the original run,
because the level is derived from score, and the theme is derived from the
level.

## Palette

Five Tokyo-Night themes, one per level:

| Level | Name             | Snake      | Accent     | Character                     |
|-------|------------------|------------|------------|-------------------------------|
| 1     | midnight-cyan    | `#1de9b6`  | `#00e5ff`  | cool, calm, baseline          |
| 2     | neon-magenta     | `#ff2e88`  | `#ff2e88`  | hot, aggressive               |
| 3     | electric-violet  | `#7c4dff`  | `#9d6bff`  | deep, electric                |
| 4     | tokyo-sunset     | `#ff5252`  | `#ff7849`  | warm, dangerous               |
| 5     | golden-hour      | `#ffd166`  | `#ffd166`  | triumphant, endgame           |

Each theme also carries its own background, grid, and head shades (see
`LEVEL_THEMES` in `app/adapters/render/theme.ts`). Food stays a constant
`#ff2e88` at every level: it is the one fixed target the player always
hunts, so it never recolors under them.

## Transition

A level-up is a visible event, not a hard cut:

- `ThemeMixer.setLevel(n)` starts a 600 ms ease-out transition **only when
  the target level actually changed** (a per-frame call site can keep
  re-asserting the current level without resetting the clock).
- `ThemeMixer.update(dt)` lerps the live colours toward the target and
  rebuilds cached CSS strings only for channels that moved.
- The 2D framebuffer reads the live colours; the GL composite takes the
  live background as a uniform, so both tiers animate in lock-step.
- The HUD accent is a registered CSS custom property (`@property --neon`),
  so `#screen { transition: --neon .6s }` interpolates the DOM side too.
  Browsers without `@property` fall back to an instant swap — still
  correct, just not eased.

## Allocation

Steady state is allocation-free: colour arrays are preallocated and
mutated in place; CSS strings are cached and rebuilt only while a shift is
live (~40 frames per level-up). The `shifting` flag in `main.ts` is the
only thing that touches the DOM during a transition, and only then.

## Files

- `app/adapters/render/theme.ts` — palettes + `ThemeMixer` (pure math,
  unit-tested in `tests/unit/theme.test.ts`).
- `app/adapters/render/framebuffer.ts` — `setTheme()` + `col()` (falls back
  to the base palette when no theme is set, so unit contexts keep working).
- `app/adapters/render/gl/effects.ts` — `render(..., bg)`; `uBg` and the
  clear colour follow the live background.
- `index.html` — `@property --neon` + accent usages via `var(--neon)`.
- `tests/e2e/theme.spec.ts` — a level-up re-tints the scene, sets
  `data-level`, and settles on the new palette.
