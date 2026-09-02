/**
 * Fixed-timestep accumulator loop. Wall-clock deltas are accumulated and
 * consumed in whole `tickMs` chunks; whatever remains becomes `alpha` for
 * render interpolation. The domain never sees any of this: it is stepped
 * one tick at a time by `onTick`.
 */
export interface LoopHooks {
  /** Current tick interval in ms (may change per level). */
  tickMs(): number;
  /** Advance the simulation by exactly one tick. */
  onTick(): void;
  /** Draw one frame; `alpha` in [0,1) is the fraction into the next tick. */
  onFrame(alpha: number, frameMs: number): void;
}

export interface LoopClock {
  now(): number;
  schedule(cb: (t: number) => void): number;
  cancel(handle: number): void;
}

export interface Loop {
  start(): void;
  stop(): void;
  running(): boolean;
  /** Ticks consumed by the most recent frame (0..MAX_CATCHUP). */
  lastTicks(): number;
  /** Discard accumulated time (after a pause, a tab switch, a level change). */
  resetAccumulator(): void;
}

/** Catch-up cap: a long stall never turns into a burst of ticks. */
export const MAX_CATCHUP = 5;

const rafClock: LoopClock = {
  now: () => performance.now(),
  schedule: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h)
};

export function createLoop(hooks: LoopHooks, clock: LoopClock = rafClock): Loop {
  let handle = 0;
  let active = false;
  let last = 0;
  let acc = 0;
  let ticks = 0;

  const frame = (): void => {
    if (!active) return;
    const now = clock.now();
    const dt = Math.max(0, now - last);
    last = now;
    acc += dt;
    const tickMs = hooks.tickMs();
    ticks = 0;
    while (acc >= tickMs && ticks < MAX_CATCHUP) {
      hooks.onTick();
      acc -= tickMs;
      ticks++;
    }
    // A stall longer than the catch-up budget is dropped, not replayed.
    if (acc >= tickMs) acc = acc % tickMs;
    hooks.onFrame(acc / tickMs, dt);
    handle = clock.schedule(frame);
  };

  return {
    start() {
      if (active) return;
      active = true;
      last = clock.now();
      acc = 0;
      handle = clock.schedule(frame);
    },
    stop() {
      if (!active) return;
      active = false;
      clock.cancel(handle);
    },
    running: () => active,
    lastTicks: () => ticks,
    resetAccumulator() {
      acc = 0;
      last = clock.now();
    }
  };
}
