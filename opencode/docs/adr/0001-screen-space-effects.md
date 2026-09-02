# ADR 0001: Screen-space post pipeline instead of a 3D scene graph

- Status: accepted
- Date: 2026-09-02
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

Concretely (`app/adapters/render/phaser/phaser-fx.ts`):

- The 2D framebuffer (always drawn to `#game` as the guaranteed 2D fallback)
  is uploaded as an RGBA8 texture (NEAREST).
- The composite pass blits it to a screen-aligned quad at the same integer
  scale the 2D compositor uses; the quad is axis-aligned and letterboxed.
- A separate RGBA8 emissive mask (food cell, head, decaying trail) drives
  bloom; it is blurred in field space so the bloom stays aligned to the field.
- Post passes run in a fixed order over the composited image: bloom →
  curvature warp → chromatic aberration → scanline → vignette → grain →
  radial shockwave → death blur/dissolve.
- "3D-ness" (warp, aberration) is achieved purely by per-pixel UV math on the
  flat image. The composite quad itself never tilts.
- Particles are GPU-instanced additive quads at physical resolution, drawn in
  a single call from a fixed 512-capacity ring buffer (oldest evicted).

Hard bounds (enforced by the shader constants and the e2e gate):

- chromatic aberration ≤ 1.0 physical px (at every device pixel ratio);
- curvature warp ≤ ~1.5% corner-UV shift;
- the composite is always axis-aligned;
- full-frame luminance transitions ≤ 3/s (the death flash is wall-local, not
  full-screen);
- draw batches ≤ 12 at ultra (measured ~7);
- the post FBOs are capped at 1600×900 so the texture budget (< 8 MB) holds on
  any display;
- zero steady-state allocation on the per-frame path (buffers, textures, and
  FBOs are preallocated; the FX layer is a no-op that hides its canvas at the
  low/reduced tiers).

## Consequences

- **Pro — budget compliance.** The whole effect stack is a handful of
  full-screen passes and one instanced draw. At ultra it costs ~7 draw calls
  and < 8 MB of texture memory (post FBOs capped to ≤ 1600×900), well inside
  the 12-call / 8 MB budgets.
- **Pro — no scene to keep consistent.** With no camera or geometry there is
  nothing to desynchronise from the integer 2D simulation; the effects can
  never move a grid cell off its integer position.
- **Pro — deterministic, allocation-free render path.** Every buffer, texture,
  and FBO is preallocated at construction/resize; the per-frame path allocates
  nothing (verified by the steady-state heap test).
- **Pro — guaranteed fallback.** The 2D framebuffer composite is always drawn
  beneath the GL layer; a driver failure, context loss, or disabled GL drops
  straight to the 2D path, never a black screen.
- **Con — warp is a flat screen effect, not a physical lens.** The curvature
  pass is a barrel/pincushion UV remap of the 2D image, not a true refractive
  lens over 3D geometry. This matches the "3D-style" wording of the brief and
  is the correct trade-off for a 2D game; a real lens would need the 3D scene
  this decision rejects.
- **Con — post FBOs are capped.** To stay under the texture budget the post
  chain renders into FBOs capped at 1600×900 regardless of display size; on
  very large displays the post image is upscaled. Acceptable given the budget,
  and the base composite (the actual game) is always full physical resolution.
