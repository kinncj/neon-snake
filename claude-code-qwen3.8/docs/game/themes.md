# Per-level theming (presentation-owned)

Theming is owned by the **presentation** layer (`app/adapters/render/theme.ts`,
ADR 0005). The domain is theme-agnostic — it carries no colour — and the presentation
picks a **per-level neon palette** and re-tints the whole scene on a level-up. Both the
2D `Framebuffer` composite and the Phaser FX engine read the same `Palette`, so the two
layers never drift.

## The palette

A `Palette` is six colours: `bg`, `grid`, `body` (snake tail), `head`, `accent`
(eyes, FX tint, HUD), and `food`. Each level has its own accent; the accent is the
spec's per-level signature colour.

| Level | Theme | Accent | Body | Head | Food | Background |
|---|---|---|---|---|---|---|
| 1 | `midnight-cyan` | `#00e5ff` | `#0891b2` | `#00e5ff` | `#ff5d73` | `#0a0e1a` |
| 2 | `neon-magenta` | `#ff2e88` | `#c026d3` | `#ff2e88` | `#ffd166` | `#120a18` |
| 3 | `electric-violet` | `#9d6bff` | `#7c4dff` | `#9d6bff` | `#00e5ff` | `#0d0a1e` |
| 4 | `tokyo-sunset` | `#ff7849` | `#f4511e` | `#ff7849` | `#ffd166` | `#160a14` |
| 5 | `golden-hour` | `#ffd166` | `#f9a825` | `#ffd166` | `#00e5ff` | `#14100a` |

`themeForLevel(level)` clamps the level to a valid index, so an out-of-range level
still resolves to a theme (never `undefined`). `DEFAULT_THEME` is level 1's palette.

## How a level-up re-tints

On a `levelup` effect the presentation:

1. Reads `themeForLevel(newLevel)` and swaps the active `Palette`.
2. The 2D composite re-draws the next frame with the new grid / body / head / accent /
   food colours (it re-reads the palette every frame — there is no cached sprite).
3. The FX engine re-tints its background grid, particle tint, and the level-up pulse to
   the new accent.
4. The HUD's accent (the `+N` popups, the level-up banner) re-reads the new accent.

Because the re-tint is a per-frame read of the palette reference (no allocation, no
sprite rebuild), a level-up is a cheap repaint. The FX **brighter grid** (P4.3) reads
the same `grid` colour and lifts it `+34/+34/+46` on the FX layer so the field stays
legible under the CRT overlays, while the 2D path keeps the grid at full strength.

## Why presentation-owned

Keeping colour out of the domain (ADR 0005) means the sim, the replay hash, and the
e2e ground truth (the 2D composite) are independent of any theme. A theme change is a
pure presentation concern — it can be added, restyled, or swapped without touching a
single line of `app/domain`. The unit tests in `tests/unit/theme.test.ts` pin the
per-level accent and the clamp behaviour.
