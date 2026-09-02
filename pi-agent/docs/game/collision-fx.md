# Collision FX

Death is an event, not a fade-to-black. The domain already reports *how*
the snake died (`cause: "wall" | "self"` on the `died` effect); the
presentation turns each cause into a distinct visual.

## Wall slam (cause = "wall")

The head hits the boundary. The response is a hard, hot explosion:

- **Screen shake** — a 420 ms, 9 device-px LCG jitter with linear decay,
  applied to the scene composite (GL `uField` offset) and the particle pass
  (GL `uShake`). The 2D low-tier path applies the same offset to the
  `drawImage` blit so the tier doesn't feel dead.
- **Spark bursts** — three instanced particle bursts from the death cell:
  a white-hot core (34 particles, fast, 460 ms), an orange mid ring
  (22, 780 ms), and slow red embers (16, 1.1 s).
- **Shockwave ring** — the existing radial-displacement pass, re-armed at
  the death position, gated by the 3/sec full-frame flash budget.
- **Bloom flash** — a 0.9 bloom spike so the field flares before the
  death-blur/dissolve pass takes over.

## Self-bite (cause = "self")

The head chomps its own body. The response is wet and darker:

- **Chomp flash** — a quick near-white 10-particle puff (260 ms) at the
  head, reading as the bite.
- **Blood spray** — 26 dark-crimson particles (0.42, 0.05, 0.09) at mid
  speed, 900 ms, plus 14 slower droplets (1.2 s).
- **Gentler shake** — 300 ms / 6 px, clearly softer than a wall slam.
- **Death dissolve** — the same death-blur/dissolve pass as the wall slam,
  so the body still dissolves after the bite.

The cause is re-exposed on the debug surface (`deathCause()`) so e2e can
assert which FX path ran without pixel readback.

## Eat juice (cause-independent)

Eating is a small pop, not a flashbang:

- a bright 8-particle core (200 ms),
- a body-coloured puff (24 particles, 600 ms, tinted by the **live theme's
  snake colour** so the pop matches the current level palette),
- a soft food-coloured halo (12 particles, 400 ms),
- the small shockwave ring and bloom spike,
- and a DOM **score popup**: a pooled `.score-pop` node (4 nodes, reused,
  event-driven) showing `+N` (N = points actually gained, read from the
  score delta) at the eaten cell, floating up and fading over 700 ms.
  Zero steady-state work; a node is touched only on an eat.

## Screen-shake mechanics

- Deterministic: an LCG (`seed = seed * 1103515245 + 12345`) drives the
  per-frame jitter, so no `Math.random` in the FX path and no allocations.
- Allocated-free decay: `decay = 1 - t/ms`, linear ramp to zero.
- The offset is computed in device pixels (the particle coordinate space)
  and mapped into FBO-normalised space for the composite quad, so GL and
  2D tiers shake identically.

## Files

- `app/adapters/render/gl/effects.ts` — shake state + `shake()`,
  cause-branched `died` FX, themed `ate` puff, `uShake` particle uniform.
- `app/adapters/render/gl/shaders.ts` — `PARTICLE_VS` gains `uShake`.
- `app/adapters/render/framebuffer.ts` — `composite(..., shX, shY)` for the
  2D tier's shake.
- `app/main.ts` — 2D shake passthrough, score-popup pool, `deathCause()`,
  `shakeActive` on the debug `fx.info()`.
- `tests/e2e/collision.spec.ts` — wall shake + burst, `+N` popup, and a
  grown snake self-biting with `deathCause() === "self"`.
