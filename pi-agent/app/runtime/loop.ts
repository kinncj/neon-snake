import { TICK_MS } from "../domain/types";

/** Maximum catch-up ticks consumed from a single wall-clock delta. */
export const MAX_CATCHUP = 5;

export interface LoopCallbacks {
  /** Called once per fixed tick, in order. */
  onTick: () => void;
}
/**
 * Fixed-timestep accumulator. The simulation advances in TICK_MS chunks; the
 * renderer interpolates by `alpha`. All timing logic is isolated in
 * `update(dtMs)` so it can be driven by synthetic deltas in tests. The
 * requestAnimationFrame driver merely measures wall-clock deltas and forwards
 * them; it carries no simulation logic.
 */
export class FixedLoop {
  private acc = 0;
  private alphaFrac = 0;
  private running = false;
  private rafId = 0;
  private last = 0;
  private tickMs = TICK_MS;

  constructor(private readonly cbs: LoopCallbacks) {}

  /**
   * Consume a wall-clock delta in tickMs chunks, at most MAX_CATCHUP ticks.
   * Excess beyond the clamp is discarded (backlog is dropped, not queued) so
   * a long stall cannot cascade into a burst. The interval is mutable via
   * setTickMs so the level system can accelerate the game; the loop itself
   * knows nothing about levels (it just follows whatever interval it is
   * given).
   */
  update(dtMs: number): number {
    if (dtMs < 0) dtMs = 0;
    this.acc += dtMs;
    let n = 0;
    while (this.acc >= this.tickMs && n < MAX_CATCHUP) {
      this.acc -= this.tickMs;
      n += 1;
      this.cbs.onTick();
    }
    if (n === MAX_CATCHUP) {
      // Dropped the backlog: reset so the next frame starts clean.
      this.acc = 0;
    }
    this.alphaFrac = this.acc / this.tickMs;
    if (this.alphaFrac > 1) this.alphaFrac = 1;
    return n;
  }

  /** Current fixed interval in ms. */
  get tickInterval(): number {
    return this.tickMs;
  }

  /** Change the fixed interval (clamped to a sane range). */
  setTickMs(ms: number): void {
    this.tickMs = Math.min(Math.max(ms, 20), 1000);
  }

  /** Interpolation factor in [0,1) for the renderer. */
  get alpha(): number {
    return this.alphaFrac;
  }

  /** Reset the accumulator (e.g. on pause/resume). */
  reset(): void {
    this.acc = 0;
    this.alphaFrac = 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number): void => {
      if (!this.running) return;
      const dt = now - this.last;
      this.last = now;
      this.update(dt);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.reset();
  }
}
