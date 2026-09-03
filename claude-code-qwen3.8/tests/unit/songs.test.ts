import { describe, expect, it } from 'vitest'
import {
  SONG_COUNT,
  TRACKS,
  noteFreq,
  trackAt,
  trackForLevel,
} from '../../app/adapters/audio/songs'

// The spec's per-level songs, 1-based (L1..L5): name, bpm, snare, arp.
const NAMES = ['cozy-bedroom', 'window-seat', 'rainy-train', 'park-bench', 'skyline-view']
const BPMS = [70, 74, 78, 82, 86]
const SNARE = [false, true, true, true, true]
const ARP = [false, false, false, true, true]

describe('songs (presentation-owned, per-level lo-fi tracks)', () => {
  it('ships exactly five tracks, one per level, at the spec tempos', () => {
    expect(SONG_COUNT).toBe(5)
    expect(TRACKS.length).toBe(5)
    for (let i = 0; i < 5; i++) {
      const t = TRACKS[i]!
      expect(t.name).toBe(NAMES[i])
      expect(t.bpm).toBe(BPMS[i])
      expect(t.snare).toBe(SNARE[i])
      expect(t.arp).toBe(ARP[i])
      // Every track is a 4-bar loop of non-empty chords.
      expect(t.bars).toHaveLength(4)
      for (const bar of t.bars) expect(bar.length).toBeGreaterThan(0)
    }
  })

  it('trackForLevel is 1-based and clamps to the valid range', () => {
    expect(trackForLevel(1)).toBe(0)
    expect(trackForLevel(5)).toBe(4)
    // Out-of-range levels resolve to a valid track, never an out-of-bounds index.
    expect(trackForLevel(0)).toBe(0)
    expect(trackForLevel(-9)).toBe(0)
    expect(trackForLevel(6)).toBe(4)
    expect(trackForLevel(999)).toBe(4)
  })

  it('each level maps to a distinct track with a distinct tempo', () => {
    const bpms = [1, 2, 3, 4, 5].map((lv) => TRACKS[trackForLevel(lv)]!.bpm)
    expect(bpms).toEqual(BPMS)
    expect(new Set(bpms).size).toBe(5)
  })

  it('trackAt returns the track in range and undefined out of range', () => {
    expect(trackAt(0)!.name).toBe('cozy-bedroom')
    expect(trackAt(4)!.name).toBe('skyline-view')
    expect(trackAt(-1)).toBeUndefined()
    expect(trackAt(5)).toBeUndefined()
  })

  it('noteFreq resolves note names to the right frequencies', () => {
    expect(noteFreq('A4')).toBeCloseTo(440, 1)
    expect(noteFreq('A3')).toBeCloseTo(220, 1)
    expect(noteFreq('C4')).toBeCloseTo(261.63, 1)
    expect(noteFreq('Bb3')).toBeCloseTo(233.08, 1)
    expect(noteFreq('not-a-note')).toBe(0)
  })
})
