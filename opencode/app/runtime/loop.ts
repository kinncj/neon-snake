// The runtime simulation loop: a fixed-timestep accumulator driven by the
// browser's frame callback.
//
// This lives in the runtime, not the domain. The domain (step.ts) advances
// exactly one integer tick per call and knows nothing about wall-clock time;
// this loop is the only place that measures it. It accumulates the real time
// elapsed since the last frame and drains it in fixed tickMs chunks, so the
// simulation runs at a constant rate regardless of the display's refresh
// rate. A rolling alpha (accumulator / tickMs) is handed to the renderer for
// interpolating between the previous and current cell.
//
// Catch-up is clamped to `maxCatchUp` ticks per frame so a hiccup (tab
// hidden, GC pause) cannot produce a burst of ticks or an unbounded backlog;
// the leftover backlog is dropped.
//
// The clock/frame source is injected (LoopDriver) so the timing math is fully
// unit-testable without a browser. main.ts supplies the real browser driver.

export interface LoopDriver {
  /** Monotonic time in milliseconds. */
  now(): number;
  /** Schedule a callback for the next frame; returns a handle. */
  requestFrame(cb: () => void): number;
  /** Cancel a scheduled frame. */
  cancelFrame(id: number): void;
}

/** The real browser driver (performance.now + requestAnimationFrame). */
export function browserDriver(): LoopDriver {
  return {
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(() => cb()),
    cancelFrame: (id) => cancelAnimationFrame(id)
  };
}

export class FixedLoop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  /** Interpolation factor in [0,1) for the current frame. */
  alpha = 0;

  constructor(
    private driver: LoopDriver,
    private tickMs: number,
    private onTick: () => void,
    private onRender: (alpha: number) => void,
    private maxCatchUp = 5,
    /** Raw wall-clock ms since the previous frame (the governor's input). */
    private onFrame?: (deltaMs: number) => void,
    /** Wall-clock ms spent inside the frame callback (the perf budget's input). */
    private onFrameWork?: (workMs: number) => void
  ) {}

  get currentTickMs(): number {
    return this.tickMs;
  }

  /** Change the tick interval (e.g. when the level speeds the game up). */
  setTickMs(ms: number): void {
    this.tickMs = ms;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;
    this.lastTime = this.driver.now();
    this.schedule();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.driver.cancelFrame(this.rafId);
  }

  get isRunning(): boolean {
    return this.running;
  }

  private schedule(): void {
    if (!this.running) return;
    this.rafId = this.driver.requestFrame(() => this.frame());
  }

  private frame(): void {
    if (!this.running) return;
    const now = this.driver.now();
    let delta = now - this.lastTime;
    this.lastTime = now;
    if (delta < 0) delta = 0;
    // Expose the raw frame period (wall-clock ms since the previous frame)
    // to the quality governor before the accumulator consumes it.
    if (this.onFrame) this.onFrame(delta);
    this.accumulator += delta;

    let steps = 0;
    while (this.accumulator >= this.tickMs && steps < this.maxCatchUp) {
      this.accumulator -= this.tickMs;
      this.onTick();
      steps++;
    }
    // Hit the catch-up cap with time still left: drop the backlog so it
    // cannot accumulate into an unbounded (and stuttery) catch-up later.
    if (this.accumulator >= this.tickMs) {
      this.accumulator = 0;
    }

    this.alpha = this.tickMs > 0 ? this.accumulator / this.tickMs : 0;
    this.onRender(this.alpha);
    // Report the wall-clock work spent inside this frame (tick + render).
    if (this.onFrameWork) this.onFrameWork(this.driver.now() - now);
    this.schedule();
  }
}
