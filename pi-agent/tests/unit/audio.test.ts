import { describe, expect, it } from "vitest";
import {
  ChiptuneSynth,
  DUCK_CAP,
  LOOP,
  STEP_SECONDS,
  VOICES,
  adsrLevel,
  duckScale,
  freqFromMidi,
  type VoiceName
} from "../../app/adapters/audio/synth";
import {
  SONGS,
  songForLevel,
  stepSeconds,
  voiceBar
} from "../../app/adapters/audio/songs";

describe("freqFromMidi", () => {
  it("A4 = 440, octaves double", () => {
    expect(freqFromMidi(69)).toBeCloseTo(440, 6);
    expect(freqFromMidi(81)).toBeCloseTo(880, 6);
    expect(freqFromMidi(57)).toBeCloseTo(220, 6);
  });
  it("semitone ratio is 2^(1/12)", () => {
    expect(freqFromMidi(70) / freqFromMidi(69)).toBeCloseTo(Math.pow(2, 1 / 12), 6);
  });
});

describe("duckScale", () => {
  it("no scaling under the cap", () => {
    expect(duckScale([0.2, 0.3])).toBe(1);
    expect(duckScale([DUCK_CAP])).toBe(1);
  });
  it("scales exactly to the cap when over", () => {
    const scale = duckScale([0.6, 0.6]); // sum 1.2
    expect(scale * 1.2).toBeCloseTo(DUCK_CAP, 9);
    expect(scale).toBeLessThan(1);
  });
  it("empty chord scales to 1", () => {
    expect(duckScale([])).toBe(1);
  });
});

describe("adsrLevel", () => {
  const spec = VOICES.pulse;
  it("starts at 0, peaks after attack, sustains, releases to 0", () => {
    expect(adsrLevel(spec, -1, 0.3)).toBe(0);
    expect(adsrLevel(spec, 0, 0.3)).toBe(0);
    const peak = adsrLevel(spec, spec.a, 0.3);
    expect(peak).toBeCloseTo(spec.peak, 6);
    const sus = adsrLevel(spec, spec.a + spec.d + 0.01, 0.3);
    expect(sus).toBeCloseTo(spec.peak * spec.s, 6);
    expect(adsrLevel(spec, 10, 0.3)).toBe(0);
  });
  it("is monotonically non-increasing after the peak", () => {
    let prev = adsrLevel(spec, spec.a, 0.3);
    for (let t = spec.a; t <= 0.32; t += 0.001) {
      const v = adsrLevel(spec, t, 0.3);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });
  it("short notes release straight from the decay", () => {
    const dur = 0.02; // shorter than a + d
    const v = adsrLevel(spec, dur - 0.001, dur);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(spec.peak);
  });
});

describe("loop data", () => {
  it("has 16 steps with notes in a chiptune range", () => {
    expect(LOOP.length).toBe(16);
    for (const step of LOOP) {
      if (step.lead !== null) expect(step.lead).toBeGreaterThanOrEqual(48);
      if (step.lead !== null) expect(step.lead).toBeLessThanOrEqual(84);
      if (step.bass !== null) expect(step.bass).toBeGreaterThanOrEqual(36);
      if (step.bass !== null) expect(step.bass).toBeLessThanOrEqual(60);
    }
  });
  it("all four voices have valid ADSR specs", () => {
    const names: VoiceName[] = ["pulse", "triangle", "noise", "lead"];
    expect(names).toHaveLength(4);
    for (const n of names) {
      const v = VOICES[n];
      expect(v.a).toBeGreaterThan(0);
      expect(v.d).toBeGreaterThan(0);
      expect(v.s).toBeGreaterThan(0);
      expect(v.s).toBeLessThanOrEqual(1);
      expect(v.r).toBeGreaterThan(0);
      expect(v.peak).toBeGreaterThan(0);
      expect(v.peak).toBeLessThanOrEqual(0.4);
    }
    // the duck cap must bound any sum of four full-peak voices
    expect(duckScale(names.map((n) => VOICES[n].peak)) * names.reduce((a, n) => a + VOICES[n].peak, 0)).toBeLessThanOrEqual(DUCK_CAP + 1e-9);
  });
  it("step length gives a ~120bpm 16th-note grid", () => {
    expect(STEP_SECONDS).toBeCloseTo(60 / 120 / 4, 6);
  });
});

describe("ChiptuneSynth without a gesture (node / locked)", () => {
  it("stays locked and no-ops every method", () => {
    const s = new ChiptuneSynth();
    expect(s.unlocked).toBe(false);
    expect(s.getState()).toBe("locked");
    s.unlock(); // node has no AudioContext: must not throw
    s.blip("lead", 72);
    s.suspend();
    s.resume();
    s.setDucked(true);
    s.setSong(3); // pre-unlock: must remember, not throw
    s.chomp();
    s.coin();
    s.boom();
    s.splat();
    s.jingle();
    s.gameover();
    s.click(); // every SFX must no-op cleanly when locked
    const d = s.debug();
    expect(d.unlocked).toBe(false);
    expect(d.state).toBe("locked");
    expect(d.duckCap).toBe(DUCK_CAP);
    expect(d.song).toBe(3);
    expect(d.sfx.chomp).toBe(0);
  });
});

describe("per-level songs (pure data)", () => {
  it("ships five songs with unique names", () => {
    expect(SONGS.length).toBe(5);
    expect(new Set(SONGS.map((x) => x.name)).size).toBe(5);
  });

  it("tempos climb with the level (harder = faster)", () => {
    for (let i = 1; i < SONGS.length; i++) {
      expect(SONGS[i]!.bpm).toBeGreaterThan(SONGS[i - 1]!.bpm);
    }
    expect(stepSeconds(120)).toBeCloseTo(60 / 120 / 4, 9);
  });

  it("chords are valid ascending 5-voice MIDI progressions", () => {
    for (const song of SONGS) {
      expect(song.chords.length).toBeGreaterThanOrEqual(2);
      for (const chord of song.chords) {
        // The lo-fi spec: every chord holds five voices (triad + 7th + 9th).
        expect(chord.length).toBe(5);
        for (const m of chord) {
          expect(m).toBeGreaterThanOrEqual(21);
          expect(m).toBeLessThanOrEqual(108);
        }
        for (let i = 1; i < chord.length; i++) {
          expect(chord[i]!).toBeGreaterThan(chord[i - 1]!);
        }
      }
    }
  });

  it("songForLevel clamps like the theme table", () => {
    expect(songForLevel(0)).toBe(SONGS[0]);
    expect(songForLevel(1)).toBe(SONGS[0]);
    expect(songForLevel(5)).toBe(SONGS[4]);
    expect(songForLevel(99)).toBe(SONGS[4]);
  });

  it("voiceBar emits the drum grid only when the pattern says so", () => {
    const quiet = SONGS[0]!; // L1: kick + hats, but NO snare (ambient intro)
    const bar = voiceBar(quiet, 0);
    expect(bar.length).toBe(16);
    expect(bar.every((v) => !v.snare)).toBe(true); // L1 drops the snare
    expect(bar.filter((v) => v.kick).length).toBeGreaterThanOrEqual(2); // beats 1 & 3
    expect(bar.filter((v) => v.hat).length).toBe(8); // offbeat 16ths
    const loud = SONGS[4]!; // L5: everything on
    const bar5 = voiceBar(loud, 0);
    expect(bar5.filter((v) => v.snare).length).toBe(2); // beats 2 & 4
    expect(bar5.filter((v) => v.kick).length).toBeGreaterThanOrEqual(2);
    expect(bar5.every((v) => v.arp !== null)).toBe(true);
  });

  it("voiceBar cycles the chord across the progression", () => {
    const song = SONGS[1]!;
    const a = voiceBar(song, 0)[0]!;
    const b = voiceBar(song, 1)[0]!;
    expect(a.bass).not.toBe(b.bass); // different chord roots
    // wraps modulo the chord count
    const last = voiceBar(song, song.chords.length);
    const first = voiceBar(song, 0);
    expect(last[0]!.bass).toBe(first[0]!.bass);
  });
});
