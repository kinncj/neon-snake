import { describe, it, expect } from "vitest";
import {
  createAudio, duckScale, sfxForEffect, SFX, VOICES, VOICE_GAIN_CAP, STORAGE_KEY
} from "../../app/adapters/audio/synth";
import { EFFECT_ATE, EFFECT_DIED, EFFECT_LEVELUP, EFFECT_TURNED, CAUSE_WALL, CAUSE_SELF } from "../../app/domain/types";

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; }
  };
}

describe("ducking", () => {
  it("passes voices through until the cap and then scales them to fit", () => {
    expect(duckScale(0, 0.3)).toBe(1);
    expect(duckScale(0.5, 0.3)).toBe(1);
    expect(duckScale(0.6, 0.4)).toBeCloseTo(0.5);
    expect(duckScale(VOICE_GAIN_CAP, 0.3)).toBe(0);
    expect(duckScale(1.2, 0.3)).toBe(0);
  });
  it("no single SFX pattern exceeds the cap on its own", () => {
    for (const notes of Object.values(SFX)) {
      // Worst case: every note of the pattern sounding at once.
      let s = 0;
      for (const n of notes) s += VOICES[n.voice].gain * n.vel * duckScale(s, VOICES[n.voice].gain * n.vel);
      expect(s).toBeLessThanOrEqual(VOICE_GAIN_CAP + 1e-9);
    }
  });
});

describe("effect to sfx mapping", () => {
  it("maps eats, combos, level-ups and both death causes; ignores the rest", () => {
    expect(sfxForEffect(EFFECT_ATE, 10, 1)).toBe("chomp");
    expect(sfxForEffect(EFFECT_ATE, 20, 2)).toBe("coin");
    expect(sfxForEffect(EFFECT_LEVELUP, 2, 1)).toBe("levelup");
    expect(sfxForEffect(EFFECT_DIED, CAUSE_WALL, 1)).toBe("boom");
    expect(sfxForEffect(EFFECT_DIED, CAUSE_SELF, 1)).toBe("splat");
    expect(sfxForEffect(EFFECT_TURNED, 1, 1)).toBeNull();
  });
  it("every voice has an ADSR and every pattern is short and ordered", () => {
    for (const v of Object.values(VOICES)) {
      expect(v.adsr.attack).toBeGreaterThan(0);
      expect(v.adsr.release).toBeGreaterThan(0);
      expect(v.gain).toBeLessThanOrEqual(VOICE_GAIN_CAP);
    }
    for (const notes of Object.values(SFX)) {
      let t = 0;
      for (const n of notes) {
        expect(n.at).toBeGreaterThanOrEqual(t);
        t = n.at;
        expect(n.at + n.dur).toBeLessThan(1.5);
      }
    }
  });
});

describe("engine lifecycle", () => {
  it("creates no context and loads no engine before enable()", () => {
    let loads = 0;
    const a = createAudio({ storage: memStorage(), loadTone: async () => { loads++; throw new Error("not in this test"); } });
    a.onEffect(EFFECT_ATE, 10, 1);
    a.trigger("boom");
    a.setMuted(true);
    a.suspend();
    expect(loads).toBe(0);
    expect(a.contextCreated()).toBe(false);
    expect(a.enabled()).toBe(false);
    expect(a.voiceSum()).toBe(0);
    expect(a.song()).toBe("");
    a.playSong(1);
    expect(loads).toBe(0);
  });
  it("persists the mute state and reads it back", () => {
    const s = memStorage();
    const a = createAudio({ storage: s });
    expect(a.muted()).toBe(false);
    a.setMuted(true);
    expect(s.getItem(STORAGE_KEY)).toBe("off");
    const b = createAudio({ storage: s });
    expect(b.muted()).toBe(true);
    b.setMuted(false);
    expect(s.getItem(STORAGE_KEY)).toBe("on");
  });
  it("a failing engine load reports false and stays disabled", async () => {
    const a = createAudio({ storage: null, loadTone: async () => { throw new Error("no audio here"); } });
    expect(await a.enable()).toBe(false);
    expect(a.enabled()).toBe(false);
    expect(a.contextCreated()).toBe(false);
  });
});
