# Collision FX and screen-space effects

All FX is **screen-space only** (ADR 0001): no scene graph, no perspective, no 3D, no
moving camera. The FX layer is a Phaser 4 WebGL canvas (`app/adapters/render/phaser/phaser-fx.ts`)
composited *over* the 2D `Framebuffer` (the always-drawn ground truth). The FX canvas
is tier-gated (`fxActive(tier)`) — at the `low` tier it is off entirely and the 2D
composite is the whole render, so the game is never a black screen if WebGL is absent.

Effects are driven by the domain's **effect sink**: the sim emits a bounded ring of
`Effect`s (`ate` / `levelup` / `died`) each tick, and `handleEffects()` in `main.ts`
reads them read-only to spawn the presentation. It never mutates domain state.

## The particle system

`ParticleSystem` (`app/adapters/render/particles.ts`) is a **fixed 512-slot ring
buffer** — no per-burst allocation in steady state. `burst(x, y, count, opts)` fills the
next ring slots with a position, velocity, life, size, colour, and (for directed bursts)
an angle-centre / spread. Particles are presentation-only and transient: in steady state
(no recent burst) `active` is 0 and the 2D draw is a no-op, so the zero-allocation budget
holds. At `ultra`, the whole FX frame is ≤ 12 draw batches (Phaser batches the quads).

## Per-event FX

| Event | Particles | Tint | Flash | Shake | Other |
|---|---|---|---|---|---|
| **ate** | 14, speed 70, 480 ms, size 1.4 | food colour | — | — | DOM `+N` score popup |
| **levelup** | 26, speed 110, 700 ms, size 1.6 | accent | — | — | `levelUpPulse()`, banner |
| **died (self)** | 46, speed 130, 900 ms, size 1.9 | wet red (`BLOOD`) | `flash(0.6, full)` | `shake(6)` | dissolves → game-over |
| **died (wall)** | 44, speed 170, 900 ms, size 1.5 | accent | `flash(1, L/R)` | `shake(12)` | `shockwave(x, y)` |

- **Wall death** — the 44 sparks fly **away from the wall** (the burst's angle-centre is
  aimed off the face the head hit: right wall → `+x`, left wall → `-x`, bottom → `+y`,
  top → `-y`, with a `0.9π` spread). A **hard wall-local flash** (`flash(1, dir)`) lights
  only the half the head hit (not a full-frame blowout), a **radial shockwave** expands
  from the head, and a **strong shake** (`12` device px) kicks the camera.
- **Self-bite** — a wet "blood" splatter (theme-agnostic red, so it reads as blood under
  any theme) radiates from the head with a soft full-frame flash and a lighter shake.

## The flash / shake / shockwave prims

All three are decaying scalars on the FX layer, read each frame:

- **`flash(power, dir)`** — a full-frame or wall-local (L/R) white flash, decaying at
  `3.2/s`. `dir` 0 = full frame, ±1 = the wall half. Capped at `≤ 3` flashes/s by the
  death-sequence budget (the e2e `death-seq.spec.ts` reads the *2D composite's* centre
  pixel — deterministic — so the brightened FX grid never flakes the count).
- **`shake(px)`** — a camera jitter in device px, decaying at `60/s`; the field draw is
  offset by a decaying jitter.
- **`shockwave(x, y)`** — an expanding ring from a framebuffer-pixel position, decaying
  at `2.6/s`.
- **`levelUpPulse()`** — a brief accent pulse on a level-up.

Every full-frame flash is **confined to the letterbox / bezel region and the CRT
overlays**, never a dark radial vignette over the playfield — the playfield-visibility
rule (ADR 0001, and a standing user constraint) keeps post-FX off the playable area.

## Quality tiers

The FX canvas is gated by the quality governor (`fxActive(tier)`):

- **`low`** — the FX canvas is off; the 2D composite is the entire render. (Headless
  CI has no WebGL2, so the perf gate measures this guaranteed-fallback path.)
- **`high`** — snake / food / particles / shake, **no** CRT overlays.
- **`ultra`** — everything, including the CRT overlays; the FX grid is brightened
  `+34/+34/+46` (0.9 alpha) so it stays legible under the overlays.

The Effects toggle in the settings panel forces the governor to `reduced`, and the
black-frame watchdog (`fxHealthy()`) falls back to the 2D composite if the WebGL layer
ever reports an unhealthy (all-black) frame.
