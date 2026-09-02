# Build report — neon snake

Final state after Phase 1 (steps 1–16). Phases 2–4 append to this report as
they ship; every row names the command that reproduces the number.

## Gates

| Gate | Command | Measured | Budget | Status |
|---|---|---|---|---|
| Lint (incl. domain boundary) | `make lint` | 0 errors | 0 | green |
| Typecheck (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes) | `make typecheck` | 0 errors | 0 | green |
| Unit + perf | `make test` | 17 files, 98 tests | all green | green |
| Production build | `make build` | 465.4 KB gzipped total (`dist/`) | ≤ 500 KB | green |
| E2E matrix | `make test-e2e` | 64 passed, 2 skipped (Chromium-only perf on Firefox) | 0 failed | green |
| Replay hash (5000 ticks, `run-a.log`, seed `snake-0001`) | `npx vitest run tests/unit/replay.test.ts` | `52b1ba03` on two independent engines (was `d0f10c02` before level scoring, step 17) | equal | green |
| Tier-independent simulation | `npx playwright test tests/e2e/effects.spec.ts` | hash identical at low / high / ultra / reduced | equal | green |
| p95 frame work at `low`, 4× CPU throttle, 600 frames | `npx playwright test --project=chromium tests/e2e/perf.spec.ts` | p50 0.80 ms, p95 1.20 ms, max 1.80 ms | < 16.7 ms | green |
| p95 frame work at `low` (node, stub context, 600 frames × 4) | `make bench` | see `tests/perf/frame.test.ts` (asserts p95 × 4 < 16.7 ms) | < 16.7 ms | green |
| Steady-state allocation (1000-frame warm-up, 600 frames) | `node --expose-gc node_modules/.bin/vitest run tests/perf` | < 64 B/frame with gc exposed | ~0 | green |
| GPU draw batches at `ultra` | `npx playwright test tests/e2e/tier.spec.ts` | 10 draw calls/frame (counted on the GL context) | ≤ 12 | green |
| Full-frame luminance transitions during death | `npx playwright test tests/e2e/effects.spec.ts` | 0 per second at the field centre (2D framebuffer) | ≤ 3/s | green |
| Bloom pulse on eat | same spec | glow strength rises > +1 and settles within 450 ms | rise + decay ≤ 400 ms | green |
| Time to interactive (first tick after navigation) | `npx playwright test --project=chromium tests/e2e/perf.spec.ts` | 256 ms (local preview) | ≤ 1.5 s | green |
| No `AudioContext` before a gesture | `npx playwright test tests/e2e/audio.spec.ts` | 0 contexts after 800 ms idle; 1 after the first key | 0 before | green |
| Voice gain ducking | same spec + `tests/unit/audio.test.ts` | instantaneous voice-gain sum ≤ 0.8 | ≤ 0.8 | green |
| Viewport matrix 320×480@1 … 5120×1440@2 | `npx playwright test tests/e2e/viewport.spec.ts` | integer scale, field inside backing store, letterbox black | no clipping | green |

Measurements were taken on the build host (Chromium headless with software
GL: `hardwareConcurrency` 32, `MAX_TEXTURE_SIZE` 8192, WebGL2 present, so
the probe starts at `ultra`).

## Domain lint boundary audit

`eslint.config.js` restricts `app/domain/**`:

- imports: no `**/adapters/**`, `**/runtime/**`, `*.css`;
- globals: `window`, `document`, `navigator`, `performance`,
  `requestAnimationFrame`, `setTimeout`, `setInterval`, `AudioContext`;
- properties: `Math.random`, `Date.now`.

Audit of `app/domain/*.ts` (`grep -nE "window|document|navigator|performance|requestAnimationFrame|setTimeout|setInterval|AudioContext|Math\.random|Date" app/domain/*.ts`) returns no matches. The only imports in the domain are relative imports of other domain modules.

## Deviations

- **Engines from the start.** The as-built spec names Phaser 4 and Tone.js
  as the shipped engines (ADR 0007). This build implemented step 14 on
  Phaser 4 and step 15 on Tone.js directly instead of first hand-rolling a
  WebGL post chain and raw Web Audio graph and then migrating. Step 24
  therefore verifies the engine contracts and records ADR 0007 rather than
  performing a migration.
- **No bloom filter in Phaser 4.** The "bloom from the emissive mask" pass
  is realised as per-layer Glow filters on the snake and food Graphics
  (the emissive set), pulsed on eat. Chromatic aberration and curvature are
  not enabled; their bounds are recorded in ADR 0001 for when they are.
- **`replay.ts` in the domain.** The spec lists six domain files; this
  build adds `app/domain/replay.ts` (log parser + replay driver) because
  both the unit suite and the in-page debug API need it and it must stay
  pure.
- **Replay hash.** The spec's reference hash (`2e58d3c2`) belongs to its
  own fixture and serialisation; this build's pinned hash is `52b1ba03`
  for its own committed `tests/fixtures/run-a.log` (526 intents, recorded
  by `scripts/gen-fixture.ts`).
- **Draw-batch metric.** Phaser 4's WebGL renderer does not maintain a
  `drawCount`; the metric is the number of `drawArrays`/`drawElements`
  calls per frame counted on the raw context.
- **Budget test order.** `make ci` runs unit tests before `make build`; the
  bundle-budget test builds `dist/` itself when it is missing so a clean
  checkout still measures the real bundle.
- **Headless GL.** Under the software renderer the ultra tier sustains
  ~20 frames/s at 1280×800; the death-luminance probe collected 20 samples
  in its 1 s window. Real GPUs are far faster; the governor exists for
  exactly this case.

## Integrity note

The high score is stored with an FNV-1a checksum over a build constant.
This is deterrence against casual edits, not security: the bundle is public
and anyone can forge a record. The game is client-only, so nothing of value
depends on it.
