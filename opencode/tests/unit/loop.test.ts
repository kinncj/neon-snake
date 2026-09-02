import { describe, expect, it } from "vitest";
import { FixedLoop, type LoopDriver } from "../../app/runtime/loop";

/**
 * A manual driver: `frame(ms)` advances the clock by ms and runs the
 * currently scheduled frame callbacks (the loop reschedules itself at the
 * end of each frame, so one pending callback per frame is the normal state).
 */
function makeDriver() {
  let t = 0;
  let pending: Array<() => void> = [];
  let idc = 0;
  const driver: LoopDriver = {
    now: () => t,
    requestFrame: (cb) => {
      const id = ++idc;
      pending.push(cb);
      return id;
    },
    cancelFrame: () => {
      // The loop's own running-flag guard makes a no-op cancel safe here.
    }
  };
  return {
    driver,
    frame: (ms: number): void => {
      t += ms;
      const q = pending;
      pending = [];
      for (const cb of q) cb();
    }
  };
}

describe("FixedLoop", () => {
  it("consumes exactly one tick per frame when the frame equals tickMs", () => {
    const { driver, frame } = makeDriver();
    let ticks = 0;
    const loop = new FixedLoop(driver, 100, () => ticks++, () => {});
    loop.start();
    frame(100);
    frame(100);
    frame(100);
    expect(ticks).toBe(3);
    expect(loop.alpha).toBe(0);
  });

  it("accumulates sub-tick frames and only ticks when a full tick has elapsed", () => {
    const { driver, frame } = makeDriver();
    let ticks = 0;
    let lastAlpha = -1;
    const loop = new FixedLoop(driver, 100, () => ticks++, (a) => (lastAlpha = a));
    loop.start();
    // six 16ms frames = 96ms: no tick yet, alpha climbs
    for (let i = 0; i < 6; i++) frame(16);
    expect(ticks).toBe(0);
    expect(lastAlpha).toBeCloseTo(0.96, 5);
    // the seventh frame crosses the 100ms boundary
    frame(16); // 112ms total
    expect(ticks).toBe(1);
    expect(lastAlpha).toBeCloseTo(0.12, 5);
  });

  it("clamps catch-up to maxCatchUp ticks per frame and drops the backlog", () => {
    const { driver, frame } = makeDriver();
    let ticks = 0;
    const loop = new FixedLoop(driver, 100, () => ticks++, () => {}, 5);
    loop.start();
    frame(1000); // a 1s hiccup
    expect(ticks).toBe(5); // not 10
    expect(loop.alpha).toBe(0); // backlog dropped, no unbounded catch-up
    // and the next normal frame behaves normally
    frame(100);
    expect(ticks).toBe(6);
  });

  it("reports alpha in [0,1) for every frame", () => {
    const { driver, frame } = makeDriver();
    const alphas: number[] = [];
    const loop = new FixedLoop(driver, 120, () => {}, (a) => alphas.push(a));
    loop.start();
    for (const ms of [1, 17, 33, 50, 119, 121, 250, 7, 300]) frame(ms);
    expect(alphas.length).toBe(9);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it("setTickMs changes the tick rate for subsequent frames", () => {
    const { driver, frame } = makeDriver();
    let ticks = 0;
    const loop = new FixedLoop(driver, 100, () => ticks++, () => {});
    loop.start();
    frame(100);
    expect(ticks).toBe(1);
    loop.setTickMs(50);
    frame(50);
    frame(50);
    expect(ticks).toBe(3);
    expect(loop.currentTickMs).toBe(50);
  });

  it("stop() halts ticking; a stale frame callback is a no-op", () => {
    const { driver, frame } = makeDriver();
    let ticks = 0;
    const loop = new FixedLoop(driver, 100, () => ticks++, () => {});
    loop.start();
    frame(100);
    expect(ticks).toBe(1);
    loop.stop();
    expect(loop.isRunning).toBe(false);
    frame(100);
    frame(100);
    expect(ticks).toBe(1); // no further ticks after stop
  });

  it("ignores a backward clock jump", () => {
    let t = 1000;
    let pending: Array<() => void> = [];
    const driver: LoopDriver = {
      now: () => t,
      requestFrame: (cb) => {
        pending.push(cb);
        return 1;
      },
      cancelFrame: () => {}
    };
    let ticks = 0;
    const loop = new FixedLoop(driver, 100, () => ticks++, () => {});
    loop.start(); // lastTime = 1000
    const q0 = pending;
    pending = [];
    for (const cb of q0) cb(); // first frame at t=1000, delta 0
    // clock jumps backwards
    t = 500;
    const q1 = pending;
    pending = [];
    for (const cb of q1) cb(); // delta = -500, must be clamped to 0
    expect(ticks).toBe(0);
  });
});
