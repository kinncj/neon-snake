# ADR 0001: Screen-space post pipeline instead of a 3D scene graph

- Status: accepted
- Date: 2026-09-01
- Deciders: project author

## Context

The brief asks for a "neo-retro" snake with "3D-style" visual effects — bloom,
curvature warp, chromatic aberration, radial shockwave, particle bursts, death
dissolve — on a fixed 32×30 grid rendered to a 256×240 virtual framebuffer.
Two broad approaches were on the table:

1. Model the board as a real 3D scene (mesh/grid, a camera, lights) and run the
   effects as GPU shader passes over the rendered scene, then project back.
2. Keep the game a pure 2D simulation and apply every effect as a flat,
   screen-space operation on the already-composited 2D image.

The simulation is fully 2D and integer-typed (a domain rule enforced by lint):
there is no depth, no per-vertex geometry, and the "camera" is a fixed
integer-scaled, letterboxed blit of the framebuffer. Introducing a real 3D
scene graph would have required a WebGL scene, a perspective matrix, a movable
camera, and a lighting model — none of which the gameplay or the brief needs.

## Decision

All visual effects are **screen-space passes over the composited 2D
framebuffer**. There is no scene graph, no mesh/tube geometry, no perspective
projection, no movable camera, and no scene lighting.

Concretely (`app/adapters/render/gl/*`):

- The 2D framebuffer is uploaded as an RGBA8 texture (NEAREST).
- The composite pass blits it to a screen-aligned quad at the same integer
  scale the 2D compositor uses; the quad is axis-aligned and letterboxed.
- A separate R8 emissive mask (food cell, head, decaying trail) drives bloom.
- Post passes run in a fixed order over the composited image: bloom →
  curvature warp → chromatic aberration → scanline → vignette → grain →
  radial shockwave → death blur/dissolve.
- "3D-ness" (warp, aberration, parallax) is achieved purely by per-pixel UV
  math on the flat image. Parallax/tilt only offsets background and particle
  layers; the composite quad itself never tilts.
- Particles are GPU-instanced additive quads at physical resolution.

## Consequences

- **Pro — budget compliance.** The whole effect stack is a handful of
  full-screen passes and one instanced draw. At ultra it costs ≤ 7 draw calls
  and < 8 MB of texture memory (post FBOs are capped to ≤ 1024×576), well
  inside the 12-call / 8 MB budgets.
- **Pro — no scene to keep consistent.** With no camera or geometry there is
  nothing to desynchronise from the integer 2D simulation; the effects can
  never move a grid cell off its integer position.
- **Pro — deterministic, allocation-free render path.** Every buffer, texture,
  and FBO is preallocated at construction; the per-frame path allocates
  nothing (verified by the steady-state heap test).
- **Con — warp is a flat screen effect, not a physical lens.** The curvature
  pass is a barrel/pincushion UV remap of the 2D image, not a true refractive
  lens over 3D geometry. This matches the "3D-style" wording of the brief and
  is the correct trade-off for a 2D game; a real lens would need the 3D scene
  this decision rejects.
- **Con — post FBOs are capped.** To stay under the texture budget the post
  chain renders into FBOs capped at 1024×576 regardless of display size; on
  very large displays the post image is upscaled. Acceptable given the budget,
  and the base composite (the actual game) is always full physical resolution.
