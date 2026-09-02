import { describe, it, expect } from "vitest";
import { hash, serialize } from "../../app/domain/hash";
import { init, step, apply } from "../../app/domain/step";
import { createSink, turnIntent, EFFECT_TURNED, emit } from "../../app/domain/types";

describe("hash", () => {
  it("is 8 lowercase hex digits", () => {
    expect(hash(init("snake-0001"))).toMatch(/^[0-9a-f]{8}$/);
  });
  it("is equal for equal states and differs after a tick", () => {
    const a = init("snake-0001");
    const b = init("snake-0001");
    expect(hash(a)).toBe(hash(b));
    step(a, createSink());
    expect(hash(a)).not.toBe(hash(b));
    step(b, createSink());
    expect(hash(a)).toBe(hash(b));
  });
  it("differs across seeds", () => {
    expect(hash(init("snake-0001"))).not.toBe(hash(init("snake-0002")));
  });
  it("covers pending turns, score, phase and rng", () => {
    const s = init("snake-0001");
    const h0 = hash(s);
    apply(s, turnIntent(1));
    const h1 = hash(s);
    expect(h1).not.toBe(h0);
    s.score = 10;
    const h2 = hash(s);
    expect(h2).not.toBe(h1);
    s.phase = "paused";
    const h3 = hash(s);
    expect(h3).not.toBe(h2);
    s.rng = (s.rng + 1) >>> 0;
    expect(hash(s)).not.toBe(h3);
  });
  it("excludes effects", () => {
    const s = init("snake-0001");
    const sink = createSink();
    const before = serialize(s);
    emit(sink, EFFECT_TURNED, 0, 0, 1);
    expect(serialize(s)).toBe(before);
  });
  it("serialises the body as x,y pairs", () => {
    const s = init("snake-0001");
    expect(serialize(s)).toContain("|b16,15;15,15;14,15;|");
  });
});
