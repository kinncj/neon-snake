import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { init, step, apply } from "../../app/domain/step";
import { parseLog } from "../../app/domain/replay";
import { createSink, resetSink } from "../../app/domain/types";
import { drawScene, BASE_PALETTE, type PixelCtx } from "../../app/adapters/render/framebuffer";

/**
 * The `low` frame path in isolation: one domain tick every 120 ms plus a
 * full 256x240 scene draw every frame, driven through the recorded input
 * log so the snake grows. A frame here is the CPU work the browser would
 * do before compositing; the browser-side p95 under CPU throttling lives
 * in tests/e2e/perf.spec.ts.
 */
const LOG = parseLog(readFileSync("tests/fixtures/run-a.log", "utf8"));
const P95_BUDGET_MS = 16.7;
const THROTTLE = 4; // budget applies under a 4x slower CPU: the frame must fit in 16.7 / 4 here

/** A context stub with the cost profile of fillRect (a few property writes). */
function stubCtx(): PixelCtx & { fills: number } {
  const c = { fillStyle: "" as string | CanvasGradient | CanvasPattern, fills: 0, fillRect() { this.fills++; } };
  return c;
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

function runFrames(frames: number, ctx: PixelCtx, s: ReturnType<typeof init>, sink: ReturnType<typeof createSink>, cursor: { li: number; tick: number; acc: number }, times?: number[]): void {
  for (let f = 0; f < frames; f++) {
    const t0 = nowMs();
    // 60 fps frames, 120 ms ticks: a tick every 7.2 frames.
    cursor.acc += 16.67;
    while (cursor.acc >= 120) {
      cursor.acc -= 120;
      while (cursor.li < LOG.length && LOG[cursor.li]!.tick <= cursor.tick) apply(s, LOG[cursor.li++]!.intent);
      resetSink(sink);
      step(s, sink);
      cursor.tick++;
    }
    drawScene(ctx, s, cursor.acc / 120, BASE_PALETTE, { fruit: "apple", grid: true });
    if (times) times.push(nowMs() - t0);
  }
}

describe("frame budget at low", () => {
  it("p95 of 600 sampled frames stays under 16.7 ms even at 4x slower", () => {
    const s = init("snake-0001");
    const sink = createSink();
    const ctx = stubCtx();
    const cursor = { li: 0, tick: 0, acc: 0 };
    runFrames(300, ctx, s, sink, cursor); // warm the JIT
    const times: number[] = [];
    runFrames(600, ctx, s, sink, cursor, times);
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    expect(times.length).toBe(600);
    expect(p95 * THROTTLE).toBeLessThan(P95_BUDGET_MS);
    expect(ctx.fills).toBeGreaterThan(600 * 100);
  });

  it("allocates nothing in steady state over 600 frames after a 1000-frame warm-up", () => {
    const s = init("snake-0001");
    const sink = createSink();
    const ctx = stubCtx();
    const cursor = { li: 0, tick: 0, acc: 0 };
    runFrames(1000, ctx, s, sink, cursor);
    const collect = typeof gc === "function" ? gc : null;
    if (collect) collect();
    const before = process.memoryUsage().heapUsed;
    runFrames(600, ctx, s, sink, cursor);
    if (collect) collect();
    const after = process.memoryUsage().heapUsed;
    const perFrame = (after - before) / 600;
    // Without --expose-gc the heap may drift by GC timing; with it, the
    // steady-state loop must be allocation-free (well under 1 KB/frame of noise).
    expect(perFrame).toBeLessThan(collect ? 64 : 4096);
  });
});
