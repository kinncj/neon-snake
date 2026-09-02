import { describe, it, expect } from "vitest";
import { createHighScore, encode, decode, checksum, HIGHSCORE_KEY } from "../../app/adapters/storage/highscore";

function memStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; }
  };
}

describe("high score integrity", () => {
  it("round-trips a record", () => {
    expect(decode(encode(420))).toBe(420);
    expect(decode(encode(0))).toBe(0);
  });
  it("rejects missing, malformed and tampered records", () => {
    expect(decode(null)).toBeNull();
    expect(decode("")).toBeNull();
    expect(decode("abc")).toBeNull();
    expect(decode("12")).toBeNull();
    expect(decode("-5:" + checksum(-5))).toBeNull();
    expect(decode("999:" + checksum(420))).toBeNull(); // edited score
    expect(decode("420:00000000")).toBeNull(); // edited checksum
    expect(decode("1.5:" + checksum(1.5))).toBeNull();
  });
  it("a different build salt invalidates old records", () => {
    const rec = encode(300, "build-a");
    expect(decode(rec, "build-a")).toBe(300);
    expect(decode(rec, "build-b")).toBeNull();
  });
});

describe("high score store", () => {
  it("starts at zero, records improvements only, and persists", () => {
    const s = memStorage();
    const hs = createHighScore(s);
    expect(hs.get()).toBe(0);
    expect(hs.submit(10)).toBe(true);
    expect(hs.submit(5)).toBe(false);
    expect(hs.submit(10)).toBe(false);
    expect(hs.get()).toBe(10);
    expect(createHighScore(s).get()).toBe(10);
  });
  it("discards a tampered record and removes it", () => {
    const s = memStorage();
    s.setItem(HIGHSCORE_KEY, "99999:deadbeef");
    const hs = createHighScore(s);
    expect(hs.get()).toBe(0);
    expect(s.getItem(HIGHSCORE_KEY)).toBeNull();
  });
  it("works without storage", () => {
    const hs = createHighScore(null);
    expect(hs.submit(3)).toBe(true);
    expect(hs.get()).toBe(3);
    hs.reset();
    expect(hs.get()).toBe(0);
  });
});
