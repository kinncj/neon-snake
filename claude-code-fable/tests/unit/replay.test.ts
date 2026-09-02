import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseLog, replay } from "../../app/domain/replay";
import { init, step, apply } from "../../app/domain/step";
import { hash } from "../../app/domain/hash";
import { createSink } from "../../app/domain/types";

/** Pinned hash of seed `snake-0001` driven by tests/fixtures/run-a.log for 5000 ticks. */
export const REPLAY_SEED = "snake-0001";
export const REPLAY_TICKS = 5000;
export const REPLAY_HASH = "d0f10c02";

const LOG = parseLog(readFileSync("tests/fixtures/run-a.log", "utf8"));

describe("replay", () => {
  it("the fixture is a real run: hundreds of intents, non-decreasing ticks", () => {
    expect(LOG.length).toBeGreaterThan(300);
    for (let i = 1; i < LOG.length; i++) expect(LOG[i]!.tick).toBeGreaterThanOrEqual(LOG[i - 1]!.tick);
  });

  it("two independent engines reach the same hash", () => {
    const a = replay(REPLAY_SEED, LOG, REPLAY_TICKS);
    const b = replay(REPLAY_SEED, LOG, REPLAY_TICKS);
    expect(a).toBe(b);
  });

  it("matches the pinned hash", () => {
    expect(replay(REPLAY_SEED, LOG, REPLAY_TICKS)).toBe(REPLAY_HASH);
  });

  it("the run stays alive to the end and scores", () => {
    let alive = true;
    let score = 0;
    replay(REPLAY_SEED, LOG, REPLAY_TICKS, (s) => {
      alive = s.phase !== "gameover";
      score = s.score;
    });
    expect(alive).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it("a hand-driven engine agrees with replay()", () => {
    const s = init(REPLAY_SEED);
    const sink = createSink();
    let li = 0;
    for (let t = 0; t < REPLAY_TICKS; t++) {
      while (li < LOG.length && LOG[li]!.tick <= t) apply(s, LOG[li++]!.intent);
      sink.len = 0; sink.head = 0;
      step(s, sink);
    }
    expect(hash(s)).toBe(REPLAY_HASH);
  });

  it("a different seed or a dropped intent changes the hash", () => {
    expect(replay("snake-0002", LOG, REPLAY_TICKS)).not.toBe(REPLAY_HASH);
    expect(replay(REPLAY_SEED, LOG.slice(1), REPLAY_TICKS)).not.toBe(REPLAY_HASH);
  });
});
