import { describe, it, expect } from "vitest";
import { createLoop, MAX_CATCHUP, type LoopClock } from "../../app/runtime/loop";

/** A manual clock: `advance(ms)` moves time and fires the scheduled frame. */
function fakeClock(): LoopClock & { advance(ms: number): void; pending(): number } {
  let t = 0;
  let cb: ((t: number) => void) | null = null;
  let handles = 0;
  return {
    now: () => t,
    schedule(fn) {
      cb = fn;
      return ++handles;
    },
    cancel() {
      cb = null;
    },
    advance(ms) {
      t += ms;
      const fn = cb;
      cb = null;
      if (fn) fn(t);
    },
    pending: () => (cb ? 1 : 0)
  };
}

describe("fixed-timestep loop", () => {
  it("consumes whole ticks and exposes the remainder as alpha", () => {
    const clock = fakeClock();
    let ticks = 0;
    const alphas: number[] = [];
    const loop = createLoop({ tickMs: () => 100, onTick: () => ticks++, onFrame: (a) => alphas.push(a) }, clock);
    loop.start();
    clock.advance(50);
    expect(ticks).toBe(0);
    expect(alphas.at(-1)).toBeCloseTo(0.5);
    clock.advance(75); // acc 125 -> one tick, 25 left
    expect(ticks).toBe(1);
    expect(alphas.at(-1)).toBeCloseTo(0.25);
    clock.advance(200); // acc 225 -> two ticks, 25 left
    expect(ticks).toBe(3);
    expect(loop.lastTicks()).toBe(2);
    expect(alphas.at(-1)).toBeCloseTo(0.25);
  });

  it("clamps catch-up to MAX_CATCHUP ticks per frame and drops the rest", () => {
    const clock = fakeClock();
    let ticks = 0;
    const loop = createLoop({ tickMs: () => 10, onTick: () => ticks++, onFrame: () => {} }, clock);
    loop.start();
    clock.advance(1000);
    expect(ticks).toBe(MAX_CATCHUP);
    clock.advance(0);
    expect(ticks).toBe(MAX_CATCHUP); // the stall was dropped, not replayed
    clock.advance(10);
    expect(ticks).toBe(MAX_CATCHUP + 1);
  });

  it("reads tickMs every frame so a level change takes effect immediately", () => {
    const clock = fakeClock();
    let tickMs = 100;
    let ticks = 0;
    const loop = createLoop({ tickMs: () => tickMs, onTick: () => ticks++, onFrame: () => {} }, clock);
    loop.start();
    clock.advance(100);
    expect(ticks).toBe(1);
    tickMs = 50;
    clock.advance(100);
    expect(ticks).toBe(3);
  });

  it("stop cancels the scheduled frame; start resets the clock", () => {
    const clock = fakeClock();
    let frames = 0;
    const loop = createLoop({ tickMs: () => 100, onTick: () => {}, onFrame: () => frames++ }, clock);
    loop.start();
    expect(loop.running()).toBe(true);
    clock.advance(10);
    loop.stop();
    expect(loop.running()).toBe(false);
    expect(clock.pending()).toBe(0);
    clock.advance(10);
    expect(frames).toBe(1);
    loop.start();
    clock.advance(10);
    expect(frames).toBe(2);
  });

  it("resetAccumulator discards a pause gap", () => {
    const clock = fakeClock();
    let ticks = 0;
    const loop = createLoop({ tickMs: () => 100, onTick: () => ticks++, onFrame: () => {} }, clock);
    loop.start();
    clock.advance(90);
    loop.resetAccumulator();
    clock.advance(90);
    expect(ticks).toBe(0);
  });
});
