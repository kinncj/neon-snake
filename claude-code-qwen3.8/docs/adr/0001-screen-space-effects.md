# ADR 0001 — Screen-space effects, 2D ground truth with a defensive WebGL FX layer

- **Status:** accepted
- **Date:** 2026-09-02
- **Area:** rendering / presentation

## Context

The game must look like a fast neon-arcade snake on a wide range of hardware —
desktops, laptops, mid-range and low-power phones — while satisfying three hard
constraints that came out of the build spec:

1. **Determinism for the test harness.** The e2e suite samples pixels off the
   canvas to assert on game state. That ground truth must be reproducible
   run-to-run, independent of GPU driver, DPR, or frame timing. A WebGL frame
   that depends on the driver is not a stable assertion target.
2. **Never a black screen.** On any device (headless CI, a browser without WebGL,
   a dropped WebGL context) the player must still see a correct, playable render.
3. **Playfield legibility is non-negotiable.** A darkening post pass (vignette,
   CRT shade) must not obscure the cells the player is looking at. This was
   called out explicitly during the design pass — a full-frame radial vignette
   over the playfield was rejected.

There are two broad ways to get "neon arcade FX":

- **A 3D scene.** A perspective camera, meshes, lighting. This is what a game
  engine is most famous for, and it is the wrong tool here: the game is a
  top-down grid, the simulation is integer screen-space, and a 3D scene adds
  scene-graph state, a second coordinate system, and driver-dependent output
  that directly violates constraint (1).
- **2D screen-space effects.** Draw the field flat, and layer on top of it the
  effects that read as "arcade": additive glow, GPU-style particles, a flash,
  a camera shake, a shockwave, a subtle CRT post. Everything is 2D, in the same
  screen-space coordinate system as the sim.

## Decision

**Render in two stacked layers, both 2D screen-space:**

- **Bottom layer — the ground truth.** An offscreen `Canvas2D` framebuffer
  (`app/adapters/render/framebuffer.ts`) renders the whole field: background,
  grid, food, the blocky snake, and a shared deterministic particle buffer.
  It is *always* drawn, is device-independent, and is the source the e2e suite
  samples. It never depends on WebGL.
- **Top layer — the FX engine** (`app/adapters/render/phaser/phaser-fx.ts`).
  A WebGL canvas (Phaser) that composites *on top of* the framebuffer: a
  brightened field, an emissive food halo, the neon snake with direction-facing
  eyes, the same particle buffer (re-drawn from the shared 2D data), a full-
  frame or wall-local flash, a decaying camera shake, a radial shockwave, and —
  at the ultra tier only — a subtle CRT post (faint scanlines, a low-amplitude
  single-sine flicker, and a letterbox-confined vignette).

This is a **2D renderer used in screen-space.** There is no scene graph, no
perspective, no mesh geometry, and no second coordinate system: the FX canvas
is sized and origin-matched to the 2D layout (device px → CSS px via DPR) so the
FX field lines up exactly with the 2D field.

**FX is optional and tier-gated.** A quality governor probes the hardware once
(WebGL2 + max texture size + core count + `prefers-reduced-motion`) and picks a
starting tier; a rolling frame-time median then moves it. The FX engine is only
enabled at the `high` and `ultra` tiers. At `low` (the default on the headless
CI host, which has no WebGL2) and at `reduced` the FX canvas is hidden and its
engine ticker is **paused** — so steady-state FX cost is exactly zero and the 2D
framebuffer beneath is the visible render.

**Defensive degradation.** `init()` returns `false` on any boot failure and the
canvas is never shown; a `webglcontextlost` event hides the canvas and notifies
the governor, which drops to `low`. Every failure path lands on the 2D
framebuffer. The FX layer is a strict *upgrade* over a render that always works.

**The playfield-visibility rule.** The one post pass that darkens anything —
the vignette — is drawn **only in the letterbox** (the four border strips outside
the centred field), fading from the field edge outward. It is never painted over
the cells the player reads. The scanlines and flicker are held at a low alpha
(0.05 / ≤0.02) so they add texture without reducing legibility.

**Steady-state allocation.** In our code the per-frame FX path allocates nothing
when the FX is off (ticker paused) and only reuses two pre-created `Graphics`
objects when it is on. This is verified by the perf gate (see the build report):
p95 steady-state frame time and bounded retained-heap growth under a 4× CPU
throttle.

## Consequences

**Positive**

- Determinism is preserved by construction: the thing the tests assert on is a
  `Canvas2D` frame, identical regardless of GPU. The FX layer is decoration the
  tests do not depend on (they assert the 2D surface stays non-blank regardless
  of FX state).
- No black screen is possible: there are two independent renders and the bottom
  one never fails.
- Effects stay cheap and predictable because they are 2D draws, not a scene
  simulation; draw batches stay in the single digits.
- Low-power devices get the FX off for free via the governor; the game remains
  fully playable on the 2D path.

**Negative / accepted costs**

- Two canvases are composited on the GPU at `high`/`ultra`. This is the
  intended price of the arcade look and is exactly what the quality governor
  exists to back off of under frame-time pressure.
- The FX and 2D layers must be kept geometrically in sync (field origin, cell
  size, DPR). `resize()` derives both from the same `Layout`, so a mismatch is a
  single-site bug; the e2e "2D ground truth regardless of FX" test guards the
  invariant that the 2D layer is self-sufficient.

## Alternatives considered

- **3D scene graph / perspective.** Rejected: violates determinism and the
  2D-screen-space rule, and adds a second coordinate system for a top-down grid.
- **Single WebGL-only renderer (no 2D fallback).** Rejected: a dropped context
  or a no-WebGL device would leave a black screen; the 2D ground truth is what
  makes the harness and the "never black" rule hold.
- **Full-frame radial vignette over the whole canvas.** Rejected during the
  design pass for obscuring the playfield; replaced with a letterbox-only
  vignette.
