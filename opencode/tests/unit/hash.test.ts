import { describe, expect, it } from "vitest";
import { hash } from "../../app/domain/hash";
import { init } from "../../app/domain/step";
import { makeState, patch } from "./support/mut-state";

describe("hash", () => {
  it("is an 8-char lowercase hex string", () => {
    expect(hash(init("snake-0001"))).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic for identical states", () => {
    expect(hash(init("same-seed"))).toBe(hash(init("same-seed")));
  });

  it("differs for different seeds (different rng / food)", () => {
    expect(hash(init("seed-a"))).not.toBe(hash(init("seed-b")));
  });

  it("is sensitive to each serialised field", () => {
    const base = makeState();
    const clone = (): ReturnType<typeof makeState> =>
      makeState({
        tick: base.tick,
        dir: base.dir,
        pendingLen: base.pendingLen,
        bodyLen: base.bodyLen,
        food: { ...base.food },
        score: base.score,
        level: base.level,
        combo: base.combo,
        lastEatTick: base.lastEatTick,
        best: base.best,
        phase: base.phase,
        rng: base.rng
      });
    const h0 = hash(base);

    const t = clone();
    patch(t, { tick: 1 });
    expect(hash(t)).not.toBe(h0);

    const d = clone();
    patch(d, { dir: 2 });
    expect(hash(d)).not.toBe(h0);

    const p = clone();
    patch(p, { pendingLen: 1, pending: [2, 1] });
    expect(hash(p)).not.toBe(h0);

    const bl = clone();
    patch(bl, { bodyLen: 4 });
    expect(hash(bl)).not.toBe(h0);

    const f = clone();
    patch(f, { food: { x: 6, y: 5, kind: "apple" } });
    expect(hash(f)).not.toBe(h0);

    const fk = clone();
    patch(fk, { food: { x: 5, y: 5, kind: "orange" } });
    expect(hash(fk)).not.toBe(h0);

    const sc = clone();
    patch(sc, { score: 10 });
    expect(hash(sc)).not.toBe(h0);

    const lv = clone();
    patch(lv, { level: 2 });
    expect(hash(lv)).not.toBe(h0);

    const cb = clone();
    patch(cb, { combo: 2 });
    expect(hash(cb)).not.toBe(h0);

    const le = clone();
    patch(le, { lastEatTick: 9 });
    expect(hash(le)).not.toBe(h0);

    const bs = clone();
    patch(bs, { best: 100 });
    expect(hash(bs)).not.toBe(h0);

    const ph = clone();
    patch(ph, { phase: "paused" });
    expect(hash(ph)).not.toBe(h0);

    const rg = clone();
    patch(rg, { rng: 0xffffffff });
    expect(hash(rg)).not.toBe(h0);
  });

  it("field separator keeps adjacent fields distinct", () => {
    // "1" + "23" vs "12" + "3" must not collide: the per-field separator
    // byte keeps the serialisation unambiguous.
    const a = makeState({ score: 1, best: 23 });
    const b = makeState({ score: 12, best: 3 });
    expect(hash(a)).not.toBe(hash(b));
  });
});
