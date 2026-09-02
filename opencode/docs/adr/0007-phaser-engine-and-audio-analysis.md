# ADR 0007 — Engine decision: Phaser 4 for the render/FX layer; Tone.js for audio

Date: 2026-09-02 (UTC, phase 3, step 24)

## Status

Accepted. **Supersedes the renderer portion of ADR 0006** (which had kept the
render path hand-rolled). ADR 0006's `stats.js` dev-only decision and its
reasoning about the domain still hold. The audio decision (Tone.js) was already
in place from step 15; this ADR ratifies it and records why the bundle-size
objection to it no longer holds once the render engine was in.

## Context

Two things changed since ADR 0006:

1. **A real failure on a real GPU.** The hand-rolled raw-WebGL2 FX layer was a
   *separate opaque canvas layered above* the 2D game. On the reporter's
   machine, with FX on, that canvas came up black on **every** browser while the
   2D path (FX off) worked. That is the signature of a driver-specific WebGL
   problem (shader compile/link, context init, or context loss) that cannot be
   reproduced on headless CI (SwiftShader), and that the hand-rolled layer could
   only *detect* (watchdog) and hide — not *recover* from. The net effect was
   "FX on = black screen hiding the game."
2. **An explicit ask.** The user requested the best, most famous 2D game engine
   (and asked for an analysis of an audio library), rather than a hand-rolled
   pipeline.

ADR 0006's core argument — "the content is one small pixel image, there is no
scene graph for an engine to own" — is still true for the *domain*, but the
*render/FX layer* is exactly where the fragility lived. Owning WebGL context
lifecycle, context-loss recovery, batched sprites, particles, and camera
shake/flash is a solved problem in mature engines and a source of bespoke bugs
in a hand-rolled layer.

## Decision

- **Render/FX layer → Phaser 4.** Phaser renders the game image itself (snake,
  food, grid, particles) into a single WebGL canvas, using its built-in camera
  shake/flash, batched sprites, and texture-based post overlays (tiling
  scanlines, radial vignette). There is **no separate raw-GL "FX sheet"** that
  can silently paint black over the game — the class of bug behind the reports
  is structurally gone.
- **2D `Framebuffer` composite stays, and is now the guaranteed floor.** It is
  drawn to `#game` *every frame* (beneath the engine canvas). If Phaser is ever
  disabled (init failure or the black-frame watchdog), a correct 2D game is
  already sitting there, fully revealed.
- **Audio → Tone.js, ratified.** The pure-data lo-fi song table (`songs.ts`) and
  the Tone.js synth (PolySynth/MonoSynth/MembraneSynth/NoiseSynth voices, a
  compressor-glued master, low-pass music + SFX buses, a lookahead scheduler,
  250 ms song crossfade) are the audio engine.

### Why Phaser specifically (vs. the alternatives the user ranked)

- **Phaser** is the 2D / pixel-art standard: pixel-snapping, retro/integer
  scaling (`pixelArt: true`), a real scene/camera system (shake, flash, fade),
  and — critically — **it owns WebGL context creation and context-loss/restore
  recovery**, which is the exact robustness the hand-rolled layer lacked. It is
  a library we drive, not a framework that drives us: the fixed-timestep domain
  loop remains the only thing that advances state; the Phaser scene only *draws*
  the current state.
- **PixiJS** is a pure renderer — fast, but you write the game framework (scene
  graph, camera, particles, input) yourself. That is more hand-rolling, not
  less, which is what we are trying to stop.
- **three.js / Babylon / PlayCanvas** are 3D-first; a 32×30 grid game is 2D by
  design (ADR 0001). 3D pipeline weight (matrices, lights, cameras) is the
  heaviest possible over-investment here.
- **Defold** compiles to WASM via a desktop toolchain — a different delivery
  model than a single self-contained web bundle.

### Audio library decision: Tone.js

On analysis, **Tone.js (the #1 ranked synth library) is the audio engine** —
and it genuinely improves the implementation, not just a dependency swap:

- **Robust, sample-accurate timing.** Tone's lookahead sequencing maps note
  events to real context time, so dropped frames do not desynchronise the loop.
- **Proper voices and effect chains for free.** `PolySynth`/`MonoSynth`/
  `MembraneSynth`/`NoiseSynth` give real ADSR envelopes and oscillator shapes
  (incl. the 5-voice jazz pad); the `Compressor` + `Filter` buses are the
  "effect routing chains" the ranking highlights.
- **The footprint objection no longer holds.** An early "native Web Audio for a
  tiny bundle" position was overtaken: adopting Phaser already grew the bundle
  ~350 KB and raised the budget to 500 KB. We are clearly no longer in the
  "zero-footprint" regime the ranking reserves for native Web Audio; adding
  ~60 KB gz for Tone is a small, deliberate trade for the standard Web Audio
  library.
- **Howler** can't synthesize (file playback only) — disqualifying for a fully
  procedural soundtrack. **Pizzicato/Wad** are lighter but lack the timeline
  sequencing and effect routing; **Flocking** is generative-music oriented.

Tone.js is the audio engine. The graph is constructed only on the first user
gesture (`Tone.start()`), so the "no AudioContext before a gesture" rule holds;
the module is safe to import in Node (instruments are only built in a real
browser). The song table stays pure data (`audio/songs.ts`); the synth is the
only module that touches the audio graph.

## Trade-off: bundle size

- Phaser 4 is a single ~1.7 MB module (~350 KB gzipped); there is no lite
  sub-build. Tone.js adds ~60 KB gzipped. Together the production bundle grows
  to **~451 KB gzipped** (measured 450.6 KB at step 24).
- The bundle budget gate is **500 KB** (documented in the build report). A
  ~451 KB game is unremarkable for a web game; the cost buys cross-driver WebGL
  robustness (Phaser) and a standard, robust Web Audio engine (Tone) that the
  hand-rolled layers could not provide.
- The 2D fallback path itself remains ~25 KB; a browser with no WebGL runs the
  full game with zero *render* engine cost (Tone still drives the audio).

## How this fixes the black screen

1. **No opaque FX sheet over the game.** Phaser draws the game; the 2D
   composite is always drawn beneath it. A dead engine cannot hide a game that
   is still being rendered underneath.
2. **Engine-owned context recovery.** Phaser re-initializes its WebGL renderer
   on `webglcontextrestored` instead of leaving a black canvas.
3. **Self-test + watchdog.** `fx.selfTest()` reads the engine canvas centre via
   a 1×1 `drawImage` (cross-browser; no raw `readPixels`, so the headless
   Firefox 0x502 readback failure is irrelevant). Three consecutive black frames
   disable the engine and reveal the 2D game.
4. **Explicit renderer probe.** We pass an explicit WebGL/Canvas type (Phaser
   refuses `AUTO` in a custom-canvas environment) and log the chosen renderer.

## Consequences

- **Determinism is preserved.** The domain remains the sole authority on game
  state; Phaser never advances a tick. The replay hash is unchanged.
- **Steady-state cost is contained.** The engine's ticker is paused whenever the
  FX tier is not the visible surface (low/reduced or disabled), so a hidden
  canvas costs zero heap/CPU in steady state (guarded by the perf e2e).
- **e2e reads the 2D surface as ground truth** (`sample()`), with the engine
  separately verified by `selfTest()` and full-page screenshots. This removes
  the raw-GL readback fragility from the test contracts.
- **ADR 0006's "no engine" position is retired for the render/FX layer.** Its
  reasoning about the domain and about `stats.js` still applies.
