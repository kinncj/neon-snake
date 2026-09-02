import { describe, it, expect } from "vitest";
import { SONGS, songForLevel, eventsInWindow, songBeats, beatSeconds, type MusicEvent } from "../../app/adapters/audio/songs";

const NOTE = /^[A-G](#|b)?[0-7]$/;

describe("songs", () => {
  it("ships five tracks, one per level, 70 to 86 bpm ascending", () => {
    expect(SONGS.map((s) => s.name)).toEqual(["cozy-bedroom", "window-seat", "rainy-train", "park-bench", "skyline-view"]);
    expect(SONGS.map((s) => s.bpm)).toEqual([70, 74, 78, 82, 86]);
    for (let i = 1; i < SONGS.length; i++) expect(SONGS[i]!.bpm).toBeGreaterThan(SONGS[i - 1]!.bpm);
  });
  it("cozy-bedroom has no snare; park-bench and skyline-view add the arp", () => {
    expect(SONGS[0]!.snare).toBe(false);
    expect(SONGS.slice(1).every((s) => s.snare)).toBe(true);
    expect(SONGS.map((s) => s.arp)).toEqual([false, false, false, true, true]);
  });
  it("chords are jazz-extended (4+ notes) with valid note names and a bass per bar", () => {
    for (const s of SONGS) {
      expect(s.chords.length).toBe(s.bass.length);
      for (const c of s.chords) {
        expect(c.length).toBeGreaterThanOrEqual(4);
        for (const n of c) expect(n).toMatch(NOTE);
      }
      for (const b of s.bass) expect(b).toMatch(NOTE);
    }
  });
  it("maps levels to songs and clamps", () => {
    expect(songForLevel(1).name).toBe("cozy-bedroom");
    expect(songForLevel(5).name).toBe("skyline-view");
    expect(songForLevel(0).name).toBe("cozy-bedroom");
    expect(songForLevel(7).name).toBe("skyline-view");
    expect(beatSeconds(songForLevel(1))).toBeCloseTo(60 / 70);
  });
});

describe("scheduler", () => {
  it("windows are contiguous: adjacent windows never repeat or drop an event", () => {
    const song = songForLevel(4);
    const all: MusicEvent[] = [];
    const step = 0.7;
    const windows = Math.ceil((songBeats(song) * 2) / step);
    for (let k = 0; k < windows; k++) eventsInWindow(song, k * step, (k + 1) * step, all);
    const whole: MusicEvent[] = [];
    eventsInWindow(song, 0, windows * step, whole);
    expect(all.length).toBe(whole.length);
    const key = (e: MusicEvent) => `${e.voice}@${e.at.toFixed(3)}:${e.note}`;
    expect(new Set(all.map(key)).size).toBe(all.length);
    expect(all.map(key).sort()).toEqual(whole.map(key).sort());
  });
  it("loops past the end of the chord list", () => {
    const song = songForLevel(1);
    const a: MusicEvent[] = [];
    const b: MusicEvent[] = [];
    eventsInWindow(song, 0, 4, a);
    eventsInWindow(song, songBeats(song), songBeats(song) + 4, b);
    expect(b.map((e) => e.note)).toEqual(a.map((e) => e.note));
  });
  it("snare and arp only appear where the song enables them", () => {
    const quiet: MusicEvent[] = [];
    eventsInWindow(songForLevel(1), 0, 16, quiet);
    expect(quiet.some((e) => e.voice === "snare")).toBe(false);
    expect(quiet.some((e) => e.voice === "arp")).toBe(false);
    const busy: MusicEvent[] = [];
    eventsInWindow(songForLevel(5), 0, 16, busy);
    expect(busy.some((e) => e.voice === "snare")).toBe(true);
    expect(busy.some((e) => e.voice === "arp")).toBe(true);
    expect(busy.filter((e) => e.voice === "kick").length).toBe(8);
  });
});
