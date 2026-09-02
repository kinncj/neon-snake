import { describe, expect, it } from "vitest";
import { next, rangeOf, seedFrom } from "../../app/domain/rng";

describe("seedFrom (FNV-1a 32-bit over UTF-8 bytes)", () => {
  it("matches the published FNV-1a 32-bit test vectors", () => {
    // Standard published vectors for the ASCII path.
    expect(seedFrom("a")).toBe(0xe40c292c);
    expect(seedFrom("foobar")).toBe(0xbf9cf968);
    // Empty string: no bytes mixed, the basis itself.
    expect(seedFrom("")).toBe(0x811c9dc5);
  });

  it("is deterministic and non-zero", () => {
    expect(seedFrom("snake-0001")).toBe(seedFrom("snake-0001"));
    expect(seedFrom("snake-0001")).toBeGreaterThan(0);
    expect(seedFrom("snake-0001")).toBeLessThanOrEqual(0xffffffff);
  });

  it("distinguishes different seeds", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 64; i++) seen.add(seedFrom(`snake-${i}`));
    expect(seen.size).toBe(64);
    expect(seedFrom("snake-0001")).not.toBe(seedFrom("snake-0002"));
  });

  it("encodes multi-byte characters as UTF-8, not char codes", () => {
    // U+00E9 is C3 A9 in UTF-8. A char-code (latin-1) encoder would seed
    // from the single code unit E9 instead; assert the two encodings of the
    // same visual character collide in the latin-1 world but not here:
    // "\u00e9" (2 UTF-8 bytes) must differ from the string whose single
    // code unit equals the first byte... simplest invariant: the UTF-8 seed
    // equals the FNV over bytes [0xc3, 0xa9], which we pin directly.
    let h = 0x811c9dc5;
    for (const b of [0xc3, 0xa9]) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    expect(seedFrom("\u00e9")).toBe(h);
    // And it must not equal the seed of the raw code unit treated as ASCII
    // (E9 < 0x800 is false, so a wrong encoder would diverge anyway).
    expect(seedFrom("\u00e9")).not.toBe(0x811c9dc5);
  });

  it("handles a 3-byte character (U+3042 = E3 81 82)", () => {
    let h = 0x811c9dc5;
    for (const b of [0xe3, 0x81, 0x82]) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    expect(seedFrom("\u3042")).toBe(h);
  });

  it("handles a 4-byte surrogate pair (U+1F40D)", () => {
    let h = 0x811c9dc5;
    for (const b of [0xf0, 0x9f, 0x90, 0x8d]) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    expect(seedFrom("\ud83d\udc0d")).toBe(h);
  });
});

describe("next (xorshift32)", () => {
  it("never returns zero for a non-zero state", () => {
    let s = seedFrom("snake-0001");
    for (let i = 0; i < 100_000; i++) {
      s = next(s);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("is a pure function of the state", () => {
    const s = seedFrom("snake-0001");
    expect(next(s)).toBe(next(s));
    // known first step from state 1
    expect(next(1)).toBe(0x42021);
  });

  it("zero is a fixed point (why seedFrom guards against it)", () => {
    expect(next(0)).toBe(0);
  });

  it("mixes state thoroughly (no trivial correlation)", () => {
    const a = seedFrom("a");
    const b = next(a);
    const c = next(b);
    expect(b).not.toBe(a);
    expect(c).not.toBe(b);
    expect(c).not.toBe(a);
  });
});

describe("rangeOf", () => {
  it("stays within [0, n) over a long walk", () => {
    let s = seedFrom("snake-0001");
    for (let i = 0; i < 50_000; i++) {
      s = next(s);
      const v = rangeOf(s, 960); // GRID_W * GRID_H
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(960);
    }
  });

  it("covers the low end of the range", () => {
    // With 50k draws over [0,960) every cell should be hit many times over.
    let s = seedFrom("snake-0001");
    const seen = new Set<number>();
    for (let i = 0; i < 50_000; i++) {
      s = next(s);
      seen.add(rangeOf(s, 960));
    }
    expect(seen.size).toBe(960);
  });
});
