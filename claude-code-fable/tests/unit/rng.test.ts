import { describe, it, expect } from "vitest";
import { seedFrom, next, rangeOf } from "../../app/domain/rng";

describe("rng", () => {
  it("seedFrom is FNV-1a 32-bit", () => {
    // Known FNV-1a vectors.
    expect(seedFrom("")).toBe(0x811c9dc5);
    expect(seedFrom("a")).toBe(0xe40c292c);
    expect(seedFrom("foobar")).toBe(0xbf9cf968);
  });
  it("seedFrom never yields zero and is a uint32", () => {
    for (const s of ["", "snake-0001", "0", " "]) {
      const v = seedFrom(s);
      expect(v).not.toBe(0);
      expect(v).toBe(v >>> 0);
    }
  });
  it("next is deterministic and stays non-zero", () => {
    let a = seedFrom("snake-0001");
    let b = seedFrom("snake-0001");
    for (let i = 0; i < 10_000; i++) {
      a = next(a);
      b = next(b);
      expect(a).toBe(b);
      expect(a).not.toBe(0);
      expect(a).toBe(a >>> 0);
    }
  });
  it("next does not repeat early and spreads evenly", () => {
    const seen = new Set<number>();
    let x = seedFrom("period");
    const buckets = new Array<number>(8).fill(0);
    for (let i = 0; i < 50_000; i++) {
      x = next(x);
      seen.add(x);
      buckets[rangeOf(x, 8)]!++;
    }
    expect(seen.size).toBe(50_000);
    for (const b of buckets) expect(b).toBeGreaterThan((50_000 / 8) * 0.9);
  });
  it("rangeOf maps into [0, n)", () => {
    let x = seedFrom("range");
    for (let i = 0; i < 1000; i++) {
      x = next(x);
      const r = rangeOf(x, 7);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(7);
    }
  });
});
