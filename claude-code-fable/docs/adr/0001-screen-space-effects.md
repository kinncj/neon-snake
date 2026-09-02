# ADR 0001 — Screen-space effects only

## Status

Accepted.

## Context

The game is a 2D 8-bit snake on a fixed 32×30 grid rendered into a 256×240
virtual framebuffer. The brief asks for a neon, CRT-television look with
bloom, scanlines, vignette, curvature, chromatic aberration, particles and
shockwaves, and it forbids any 3D presentation: no scene graph, no
perspective projection, no mesh or tube geometry for the snake, no lights,
and no camera that can move a cell off screen.

Two implementation families were on the table:

1. A 3D scene (a mesh per body segment, lights, a camera) that happens to
   be viewed from above.
2. A 2D image pipeline: draw the field as pixels, then run every effect as
   an operation on that composited image.

## Decision

Every effect is a **screen-space** operation on a composited 2D image.

- The ground truth is the 256×240 framebuffer drawn by `framebuffer.ts`
  with integer coordinates and nearest-neighbour sampling, composited at an
  integer scale. It is always drawn, at every tier, beneath everything else.
- The FX layer (`phaser/phaser-fx.ts`) is a single transparent WebGL canvas
  over that composite. It redraws the same grid, blocks and sprites as
  screen-aligned rectangles and applies its effects as post-passes: emissive
  glow on the snake and food layers, an expanding-ring shockwave, a
  512-slot particle ring, a wall-local death flash, a scanline overlay with
  a slow luminance flicker, and a radial vignette. Camera shake is a
  bounded 2D translation of the whole image.
- There is no scene graph beyond a flat list of Graphics objects, no
  projection, no lights, and the camera never scrolls: the field always
  occupies the same integer-scaled rectangle.

## Hard bounds

| Effect | Bound |
|---|---|
| Chromatic aberration | ≤ 1.0 physical px at 1080p (not enabled in this build; the bound applies if it is) |
| Curvature warp | ≤ 1.5 % corner UV displacement (not enabled in this build; the bound applies if it is) |
| Composite | always axis-aligned, integer scale |
| Full-frame luminance transitions | ≤ 3 per second; death flashes are local to the wall that was hit |
| Draw batches at ultra | ≤ 12 game objects per frame |
| Particles | 512 fixed slots, oldest evicted |
| Steady-state allocation | none in the frame loop; the engine ticker sleeps when FX is off |

## Consequences

- The simulation is renderer-agnostic and hash-identical across tiers; the
  replay test proves it at `low`, `high`, `ultra` and `reduced`.
- The 2D path is a complete game on its own, so an engine failure (context
  loss, missing WebGL2) degrades to it without a black screen.
- Effects that need per-pixel access to the *game* (not the image) are out
  of scope by construction; that is the intended limitation.
