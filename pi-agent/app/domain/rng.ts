/** Pure uint32 PRNG helpers. No allocation, no globals, no time. */

/** FNV-1a 32-bit over the UTF-8 bytes of s. Result is guaranteed non-zero. */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  const mix = (b: number): void => {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
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
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (next & 0x3ff));
      mix(0xf0 | (cp >> 18));
      mix(0x80 | ((cp >> 12) & 0x3f));
      mix(0x80 | ((cp >> 6) & 0x3f));
      mix(0x80 | (cp & 0x3f));
      i++;
    }
  }
  return h === 0 ? 0x811c9dc5 : h;
}

/** xorshift32. Input and output are uint32; input must be non-zero. */
export function next(state: number): number {
  let s = state >>> 0;
  s ^= (s << 13) >>> 0;
  s ^= s >>> 17;
  s ^= (s << 5) >>> 0;
  return s >>> 0;
}

/** Uniform int in [0, n). n must be positive. */
export function rangeOf(state: number, n: number): number {
  return (state >>> 0) % n;
}
