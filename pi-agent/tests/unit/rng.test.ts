import { expect, it } from "vitest";
import { next, rangeOf, seedFrom } from "../../app/domain/rng";

// Recorded reference values. If they change, the PRNG changed.
it("seedFrom is deterministic and non-zero", () => {
  expect(seedFrom("snake-0001")).toBe(1185375157);
  expect(seedFrom("snake-0001")).toBe(seedFrom("snake-0001"));
  expect(seedFrom("")).toBe(0x811c9dc5); // empty input -> non-zero basis
});

it("next yields the recorded xorshift32 sequence", () => {
  let s = seedFrom("snake-0001");
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) {
    s = next(s);
    seen.push(s);
  }
  expect(seen).toEqual([
    4041428349,
    2966985403,
    3531261180,
    3594858574,
    2044052840
  ]);
});

it("state stays uint32 across many iterations", () => {
  let s = seedFrom("snake-0002");
  for (let i = 0; i < 10_000; i++) {
    s = next(s);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
    expect(s).toBe(s >>> 0);
  }
});

it("rangeOf bounds", () => {
  let s = seedFrom("snake-0003");
  for (let i = 0; i < 500; i++) {
    s = next(s);
    const r = rangeOf(s, 960);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(960);
  }
});
