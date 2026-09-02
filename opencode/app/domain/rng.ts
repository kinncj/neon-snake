// Pure uint32 PRNG: FNV-1a seeding, xorshift32 stepping, integer ranges.
//
// Everything is a total function on a uint32 — no allocation, no globals,
// no clock. That is what makes the simulation replayable: the same seed and
// the same intents must reproduce the exact same state, on every machine,
// at every quality tier.

const FNV_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit over the UTF-8 bytes of `s`. The result is guaranteed
 * non-zero (xorshift32 is a fixed point at zero, and a zero seed would make
 * every game from that seed identical).
 */
export function seedFrom(s: string): number {
  let h = FNV_BASIS;
  const mix = (b: number): void => {
    h ^= b;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      mix(c);
    } else if (c < 0x800) {
      mix(0xc0 | (c >> 6));
      mix(0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      mix(0xe0 | (c >> 12));
      mix(0x80 | ((c >> 6) & 0x3f));
      mix(0x80 | (c & 0x3f));
    } else {
      // High surrogate: combine with the following low surrogate into the
      // supplementary code point (4 UTF-8 bytes). A lone high surrogate
      // falls back to code unit 0 for the missing half — still deterministic.
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (next & 0x3ff));
      mix(0xf0 | (cp >> 18));
      mix(0x80 | ((cp >> 12) & 0x3f));
      mix(0x80 | ((cp >> 6) & 0x3f));
      mix(0x80 | (cp & 0x3f));
      i++;
    }
  }
  return h === 0 ? FNV_BASIS : h;
}

/**
 * xorshift32: maps a non-zero uint32 to the next non-zero uint32. Returns
 * the new state (the caller stores it); the input is left untouched.
 */
export function next(state: number): number {
  let s = state >>> 0;
  s ^= (s << 13) >>> 0;
  s ^= s >>> 17;
  s ^= (s << 5) >>> 0;
  return s >>> 0;
}

/** Uniform integer in [0, n). `n` must be positive. */
export function rangeOf(state: number, n: number): number {
  return (state >>> 0) % n;
}
