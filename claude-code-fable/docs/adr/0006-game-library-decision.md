# ADR 0006 — Game-library decision (render path, audio path, stats.js)

## Status

Accepted for the render-path analysis and the `stats.js` rule; the
renderer/audio portion is **superseded by ADR 0007** (Phaser 4 + Tone.js).

## Context

By the end of Phase 2 the game needed: a deterministic 2D field renderer,
an emissive/CRT post chain with bounded flashes, particles and shockwaves,
procedural lo-fi music with per-level crossfades, and retro SFX. The
question was whether to keep hand-rolling those on raw Canvas2D, WebGL2
and Web Audio, or to adopt libraries, and how to handle a performance
meter without shipping it to players.

## Options considered

| Option | For | Against |
|---|---|---|
| Hand-rolled Canvas2D + WebGL2 post chain + raw Web Audio | zero dependencies, full control over allocation and batches | every filter, blur pass, particle batch and context-loss path is bespoke code to test; the FX chain was the source of the "FX on = black screen" class of bug |
| A 2D engine for the FX layer only (Phaser / PixiJS) | mature WebGL batching, built-in filters (glow, blur, vignette, barrel), camera shake/flash, context-loss handling | ~350 KB gzipped; must be kept out of the domain and driven read-only |
| An audio engine (Tone.js) | scheduling, polyphony, envelopes, compressor and filters on preallocated nodes; a look-ahead transport | ~60–80 KB gzipped; its context must be created only on a gesture |
| `stats.js` for the FPS meter | trivial, familiar | must never ship to players (bundle budget, CSP, and it is not i18n'd) |

## Decision

1. **The 2D framebuffer stays hand-rolled** (`framebuffer.ts`): it is the
   ground truth beneath any engine, it is tiny, and it is the path the
   replay and viewport gates read.
2. **The FX layer and audio are candidates for real engines** rather than
   more bespoke GL and Web Audio; the choice and the migration are recorded
   in ADR 0007, which supersedes the renderer/audio portion of this ADR.
3. **`stats.js` is dev-only.** It is a `devDependency` that is never
   imported by production code; the shipped FPS meter (`ui/fps.ts`) is a
   ~40-line rolling counter. The bundle-budget unit test asserts that no
   `stats.js` code appears in `dist/`, and the Makefile builds with
   `NODE_ENV=production` explicitly so a test-launched build cannot leak
   dev-only code.

## Consequences

- Dependencies stay at exactly two runtime packages (`phaser`, `tone`) plus
  the dev toolchain.
- The domain boundary is untouched by any of this: engines live under
  `app/adapters/**` and read state; the lint rule keeps it that way.
