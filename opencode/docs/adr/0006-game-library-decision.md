# ADR 0006 — Game-library decision: hand-rolled renderer, Tone.js audio, one dev-only HUD lib

Date: 2026-09-02 (UTC, phase 2, step 23)

## Status

Accepted. Superseded (render only) by ADR 0007, which migrates the renderer to
Phaser 4 at the user's explicit demand; the hand-rolled framebuffer stays the
always-drawn 2D ground truth beneath it.

## Context

Phase 2 opened the door to "proper, latest-and-greatest" game libraries if they
genuinely help (PixiJS, Phaser, three.js, PlayCanvas) and to any tooling that
improves development. The question at step 23 is whether a scene-graph/asset
render engine earns its place in a 32×30 grid game that renders one 256×240
virtual framebuffer, and what the rest of the stack (audio, the perf HUD)
should use.

## Decision

**No scene-graph render engine. Audio on Tone.js. One exception: `stats.js`,
dev-only.**

- **Renderer stays hand-rolled** (a Canvas2D 256×240 framebuffer + a raw WebGL2
  screen-space effects layer, ADR 0001). The game's content is a single small
  pixel image; every frame is: render 256×240 → blit with integer scale → run
  flat post passes (bloom, shockwave, particles, scanline/vignette/flicker).
  There is no scene graph, mesh, light, physics body, or movable camera for an
  engine to own. The smooth walk is a pure per-segment interpolation
  (`snake-walk.ts`), not an engine tween.
- **Audio is procedural on Tone.js** (`ChiptuneSynth`). No audio *assets* ship
  — every note, envelope, drum hit, and the per-level lo-fi songs
  (`songs.ts`) are synthesized in code. Tone.js is a Web-Audio *graph*
  wrapper, not a scene engine; it owns no clock or state of the game and its
  `AudioContext` is created only on the first gesture, so the "no context
  before a gesture" contract holds.
- **`stats.js` is adopted as a devDependency** for the FPS/MS/MB perf HUD. It is
  gated behind `import.meta.env.DEV` **and** a headless-user-agent check, so it
  is stripped from production and can never mount in the e2e matrix. A bundle
  test asserts no `stats.min` chunk ships.

## Why not a render engine (yet)

- **PixiJS / Phaser** would add a full renderer + (Phaser) scene/physics/input
  stack for ~50KB+ and would own the canvas from us. Our render is a fixed
  framebuffer blit; a batched-sprite engine is the wrong tool for a single
  scaled texture, and Phaser's game loop would collide with our fixed-timestep
  domain (which must stay the only thing that advances state).
- **three.js / PlayCanvas** pull in 3D pipeline weight (matrix stack, lights,
  cameras). We are a 2D game by design (ADR 0001 forbids scene graph,
  perspective, mesh, lights, movable camera). A 3D engine is the heaviest
  possible over-investment.
- **Determinism.** The domain is a pure, replayable, integer-timestep
  simulation. A third-party *render* engine's internal clocks, pooling, and
  async loads are non-deterministic by nature and would bleed into anything they
  touch. Keeping them out of the render hot path protects the replay hash and
  the perf budgets. (Tone.js is the sanctioned exception on the audio path: it
  is event-driven, gesture-gated, and never reads or writes game state.)
- **Bundle.** Every render engine ships a large chunk and (for asset-based
  ones) requires network/font/texture loading. The project ships a single
  self-contained bundle; all sprites are procedural.

## Consequences

- **Smaller, faster, auditable.** The whole render path is a few hundred lines
  we can read, budget, and test per-pixel.
- **The one dev-only lib is safe.** `stats.js` touches neither the game state
  nor the production bundle; its presence is asserted away by the bundle test.
- **Audio is asset-free.** Tone.js synthesizes everything, so the "no audio
  asset bytes" budget holds while still getting a real multi-voice lo-fi
  graph (pad/bass/arp/kick/snare/hat) and the 250 ms song crossfade.
- **Revisit trigger.** The hand-rolled render holds until the user's explicit
  demand for "a real game engine" is honoured — that migration (Phaser 4 for
  render/FX, keeping Tone.js for audio) is ADR 0007 / step 24, and the
  framebuffer remains the guaranteed 2D fallback beneath it.
