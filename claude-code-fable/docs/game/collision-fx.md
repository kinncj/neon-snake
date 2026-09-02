# Collision FX

The domain reports a death with its cause (`wall` | `self`) in the `died`
effect; the presentation layer plays a distinct sequence for each. All of
it is screen-space (ADR 0001) and runs on the Phaser layer
(`app/adapters/render/phaser/phaser-fx.ts`); the 2D path underneath simply
snaps the snake to its final cells and darkens.

## Wall death

| Beat | What happens |
|---|---|
| tick of impact | `boom` SFX (membrane + noise + low triangle), then the gameover sting |
| 0–220 ms | a white band flashes on the wall that was hit (only that wall), decaying fast |
| 0–700 ms | 90 spark particles + 40 accent particles burst **in the direction of travel** (`angleSpread` 1.3 rad) with gravity, so they fly off the wall and never sweep the centre |
| 0–520 ms | a white shockwave ring expands from the head |
| 0–320 ms | camera shake (intensity 0.012) |
| 0–900 ms | the field dissolves toward the theme background (55 %) under the gameover panel |

## Self-bite

| Beat | What happens |
|---|---|
| tick of impact | `splat` SFX (noise + membrane + a short pulse), then the gameover sting |
| 0–650 ms | 70 "blood" particles (red) plus 20 darker droplets, omnidirectional with strong gravity |
| 0–380 ms | a red shockwave ring |
| 0–180 ms | a lighter camera shake (0.006) |
| 0–900 ms | the same dissolve into the gameover panel |

No wall flash plays for a self-bite.

## Budgets

- Full-frame luminance transitions during a death: ≤ 3 per second
  (measured 0 at the field centre; the flash is local to one wall).
- Particles: one 512-slot ring, oldest recycled; the biggest death burst
  uses 130 slots.
- A restart clears particles, shockwaves and the dissolve in the same
  frame the domain resets.
