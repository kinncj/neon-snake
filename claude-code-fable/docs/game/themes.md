# Themes

Five per-level neon palettes owned by the presentation layer
(`app/adapters/render/theme.ts`, ADR 0005). The domain only reports a
level; the renderers, HUD and overlays derive every colour from it.

| Level | Theme | bg | grid | body | head | accent |
|---|---|---|---|---|---|---|
| 1 | midnight-cyan | `#12131f` | `#1c1f33` | `#00b8d4` | `#7ff7ff` | `#00e5ff` |
| 2 | neon-magenta | `#1a1020` | `#2a1a36` | `#e0207a` | `#ff8ac2` | `#ff2e88` |
| 3 | electric-violet | `#13112a` | `#221e44` | `#8a5cf5` | `#d2c0ff` | `#9d6bff` |
| 4 | tokyo-sunset | `#1d1316` | `#33201f` | `#ff6a3d` | `#ffc6a8` | `#ff7849` |
| 5 | golden-hour | `#1a1710` | `#2f2a16` | `#f2b83a` | `#fff0b8` | `#ffd166` |

The fruit, its highlight, the stem/leaf and the eye colour are constant
across themes so food stays recognisable.

## Re-tint

A level change starts a 650 ms smoothstep mix from the current palette to
the new one. One live `Palette` object is rewritten in place each frame
and shared by the 2D framebuffer and the Phaser layer, so both surfaces
always agree. The HUD, overlays, d-pad and mute button follow the accent
through the `--accent` CSS custom property.

## On the FX path

With effects on, the CRT overlays (scanlines, vignette) darken the field,
so the engine layer draws the grid brighter (+34/+34/+46 over the theme
grid, at 0.9 alpha) while the 2D path keeps the theme grid at full
strength.
