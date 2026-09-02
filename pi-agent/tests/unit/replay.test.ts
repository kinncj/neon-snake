import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hash } from "../../app/domain/hash";
import { applyIntent, init, makeSink, reinit, step } from "../../app/domain/step";
import type { Dir, Intent, State } from "../../app/domain/types";

const SEED = "snake-0001";
const TOTAL_TICKS = 5000;

function parseLog(text: string): Map<number, Intent[]> {
  const byTick = new Map<number, Intent[]>();
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const [tickStr, kind, dirStr] = line.split(",");
    const tick = Number(tickStr);
    let intent: Intent;
    if (kind === "pause") intent = { kind: "pause" };
    else if (kind === "restart") intent = { kind: "restart" };
    else intent = { kind: "turn", dir: Number(dirStr) as Dir };
    const list = byTick.get(tick) ?? [];
    list.push(intent);
    byTick.set(tick, list);
  }
  return byTick;
}

/**
 * Step the engine for TOTAL_TICKS. The logged intents for tick t are applied
 * before step t (they take effect on the t-th move). Returns the final hash.
 * A restart intent re-inits in place with the same seed.
 */
function replay(seed: string, log: Map<number, Intent[]>): string {
  const s: State = init(seed);
  const sink = makeSink(32);
  for (let t = 1; t <= TOTAL_TICKS; t++) {
    const intents = log.get(t);
    if (intents !== undefined) {
      for (const intent of intents) {
        if (intent.kind === "restart") reinit(s, seed);
        else applyIntent(s, intent);
      }
    }
    step(s, sink);
    sink.count = 0;
  }
  return hash(s);
}

const LOG: Map<number, Intent[]> = parseLog(
  readFileSync("tests/fixtures/run-a.log", "utf8")
);

describe("hash and replay", () => {
  it("the log covers 5000 ticks with ~400 entries", () => {
  const entries = [...LOG.values()].reduce((n, l) => n + l.length, 0);
  expect(entries).toBeGreaterThanOrEqual(300);
  expect(entries).toBeLessThanOrEqual(500);
  expect([...LOG.keys()].at(-1)).toBe(4992);
});

  it("two independent engine instances produce the same hash", () => {
    const a = replay(SEED, parseLog(readFileSync("tests/fixtures/run-a.log", "utf8")));
    const b = replay(SEED, parseLog(readFileSync("tests/fixtures/run-a.log", "utf8")));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("the hash is stable across repeated runs (recorded value)", () => {
    // Recorded for fixture run-a.log, seed snake-0001, 5000 ticks.
    // If the engine or fixture changes this breaks on purpose.
    // 2e58d3c2 = phase-2 state shape (food.kind, level, combo,
    // lastEatTick, best added to the canonical serialisation).
    expect(replay(SEED, LOG)).toBe("2e58d3c2");
  });

  it("hash reflects state changes", () => {
    const a = init(SEED);
    const b = init(SEED);
    const sink = makeSink(8);
    expect(hash(a)).toBe(hash(b));
    step(a, sink);
    expect(hash(a)).not.toBe(hash(b));
    // identical histories hash identically
    step(b, sink);
    expect(hash(a)).toBe(hash(b));
  });
});
