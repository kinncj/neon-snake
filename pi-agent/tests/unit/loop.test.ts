import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TICK_MS } from "../../app/domain/types";
import type { Dir, Intent } from "../../app/domain/types";
import { applyIntent, init, makeSink, reinit, step } from "../../app/domain/step";
import { hash } from "../../app/domain/hash";
import { FixedLoop, MAX_CATCHUP } from "../../app/runtime/loop";

const DURATION_MS = 10_000;

function parseLog(text: string): Map<number, Intent[]> {
  const m = new Map<number, Intent[]>();
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const [t, kind, d] = line.split(",");
    const tick = Number(t);
    const intent: Intent =
      kind === "pause"
        ? { kind: "pause" }
        : kind === "restart"
          ? { kind: "restart" }
          : { kind: "turn", dir: Number(d) as Dir };
    const list = m.get(tick) ?? [];
    list.push(intent);
    m.set(tick, list);
  }
  return m;
}

function countTicksAtFps(fps: number): number {
  let ticks = 0;
  const loop = new FixedLoop({ onTick: () => { ticks += 1; } });
  const frames = Math.round(DURATION_MS / (1000 / fps));
  for (let f = 0; f < frames; f++) loop.update(1000 / fps);
  return ticks;
}

function replayThroughLoop(fps: number, log: Map<number, Intent[]>, seed: string): string {
  const s = init(seed);
  const sink = makeSink(32);
  let tick = 0;
  const loop = new FixedLoop({
    onTick: () => {
      tick += 1;
      const intents = log.get(tick);
      if (intents !== undefined) {
        for (const intent of intents) {
          if (intent.kind === "restart") reinit(s, seed);
          else applyIntent(s, intent);
        }
      }
      step(s, sink);
      sink.count = 0;
    }
  });
  const frames = Math.round(DURATION_MS / (1000 / fps));
  for (let f = 0; f < frames; f++) loop.update(1000 / fps);
  return hash(s);
}

describe("FixedLoop", () => {
  it("synthetic deltas at 30/60/144 fps over the same duration give the same tick count", () => {
    const a = countTicksAtFps(30);
    const b = countTicksAtFps(60);
    const c = countTicksAtFps(144);
    expect(a).toBe(Math.floor(DURATION_MS / TICK_MS));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("clamps catch-up to MAX_CATCHUP ticks per frame and drops the backlog", () => {
    let ticks = 0;
    const loop = new FixedLoop({ onTick: () => { ticks += 1; } });
    expect(loop.update(1000)).toBe(MAX_CATCHUP);
    expect(ticks).toBe(MAX_CATCHUP);
    // backlog dropped: next small delta starts fresh
    expect(loop.update(TICK_MS - 1)).toBe(0);
    expect(loop.update(1)).toBe(1);
  });

  it("alpha tracks the fractional accumulator and stays in [0,1]", () => {
    const loop = new FixedLoop({ onTick: () => undefined });
    loop.update(TICK_MS / 2);
    expect(loop.alpha).toBeCloseTo(0.5, 5);
    expect(loop.alpha).toBeGreaterThanOrEqual(0);
    expect(loop.alpha).toBeLessThan(1);
    loop.update(TICK_MS / 2);
    expect(loop.alpha).toBeCloseTo(0, 5);
  });

  it("replaying run-a.log through the loop gives the same hash at every fps", () => {
    const text = readFileSync("tests/fixtures/run-a.log", "utf8");
    const h30 = replayThroughLoop(30, parseLog(text), "snake-0001");
    const h60 = replayThroughLoop(60, parseLog(text), "snake-0001");
    const h144 = replayThroughLoop(144, parseLog(text), "snake-0001");
    expect(h30).toBe(h60);
    expect(h60).toBe(h144);
    expect(h30).toMatch(/^[0-9a-f]{8}$/);
  });
});
