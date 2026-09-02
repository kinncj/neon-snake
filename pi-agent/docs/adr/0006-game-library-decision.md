# ADR 0006 — Game-library decision: hand-rolled renderer, one dev-only HUD lib

Date: 2026-09-02 (UTC, phase 2, step 23)

## Status

Accepted.

## Context

Phase 2 explicitly opened the door to "proper, latest-and-greatest" game
libraries if they genuinely help (PixiJS, Phaser, three.js, PlayCanvas),
and to any tooling that improves development. The question is whether a
scene-graph/asset engine earns its place in a 32×30 grid game that renders
one 256×240 virtual framebuffer.

## Decision

**No scene-graph engine. One exception: `stats.js`, dev-only.**

- **Renderer stays hand-rolled** (Canvas2D framebuffer + a raw WebGL2
  screen-space effects layer). The game's content is a single small pixel
  image; every frame is: render 256×240 → blit with integer scale → run
  flat post passes. There is no scene graph, mesh, light, physics body, or
  movable camera for an engine to own.
- **`stats.js` is adopted as a devDependency** for the FPS/MS/MB perf HUD.
  It is gated behind `import.meta.env.DEV` **and** a headless-user-agent
  check, so it is stripped from production and can never mount in the e2e
  matrix. A bundle test asserts no `stats.min` chunk ships.

## Why not the engines

- **PixiJS / Phaser** would add a full renderer + (Phaser) scene/physics/
  input stack for ~50KB+ and would own the canvas from us. Our render is a
  fixed framebuffer blit; Pixi's batched sprites are the wrong tool for a
  single scaled texture, and Phaser's game loop would collide with our
  fixed-timestep domain (which must stay the only thing that advances
  state).
- **three.js / PlayCanvas** pull in 3D pipeline weight (matrix stack,
  lights, cameras). We are a 2D game by design (ADR 0001 forbids scene
  graph, perspective, mesh, lights, movable camera). A 3D engine is the
  heaviest possible over-investment.
- **Determinism.** The domain is a pure, replayable, integer-timestep
  simulation. A third-party engine's internal clocks, pooling, and async
  asset loads are non-deterministic by nature and would bleed into anything
  they touch. Keeping them out of the render hot path protects the replay
  hash and the perf budgets.
- **Bundle + CSP.** Every engine ships a large chunk and (for asset-based
  ones) requires network/font/texture loading. The project ships a single
  self-contained bundle; all sprites and audio are procedural.

## Consequences

- **Smaller, faster, auditable.** The whole render path is a few hundred
  lines we can read, budget, and test per-pixel.
- **The one dev-only lib is safe.** `stats.js` touches neither the game
  state nor the production bundle; its presence is asserted away by the
  bundle test.
- **Revisit trigger.** If the game ever grows to real-time entities (hundreds
  of sprites, camera, tiles), PixiJS becomes the first candidate — but that
  is a different project's scale.
