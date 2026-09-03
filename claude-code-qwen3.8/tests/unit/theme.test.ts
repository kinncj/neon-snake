import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, themeForLevel, type Theme } from '../../app/adapters/render/theme'

// The spec's per-level accents, 1-based (L1..L5).
const ACCENTS = ['#00e5ff', '#ff2e88', '#9d6bff', '#ff7849', '#ffd166']
const NAMES = ['midnight-cyan', 'neon-magenta', 'electric-violet', 'tokyo-sunset', 'golden-hour']

const HEX = /^#[0-9a-f]{6}$/i

function isTheme(t: Theme): void {
  // Every palette role is a 6-digit hex colour.
  const p = t.palette
  for (const v of [p.bg, p.grid, p.body, p.head, p.accent, p.food]) {
    expect(v).toMatch(HEX)
  }
  expect(t.accent).toMatch(HEX)
}

describe('theme (presentation-owned, per-level palettes)', () => {
  it('ships exactly five themes, one per level', () => {
    expect(ACCENTS.length).toBe(5)
    for (let level = 1; level <= 5; level++) {
      const t = themeForLevel(level)
      isTheme(t)
      // The level's accent is the spec accent, and the head is drawn in the accent.
      expect(t.accent).toBe(ACCENTS[level - 1])
      expect(t.palette.accent).toBe(ACCENTS[level - 1])
      expect(t.palette.head).toBe(t.accent)
      expect(t.name).toBe(NAMES[level - 1])
    }
  })

  it('themeForLevel is 1-based and clamps to the valid range', () => {
    expect(themeForLevel(1).accent).toBe(ACCENTS[0])
    expect(themeForLevel(5).accent).toBe(ACCENTS[4])
    // Out-of-range levels resolve to a valid palette (the top), never undefined.
    expect(themeForLevel(0).accent).toBe(ACCENTS[0])
    expect(themeForLevel(-9).accent).toBe(ACCENTS[0])
    expect(themeForLevel(6).accent).toBe(ACCENTS[4])
    expect(themeForLevel(999).accent).toBe(ACCENTS[4])
  })

  it('adjacent levels have distinct accents (a level-up visibly re-tints)', () => {
    const accents = ACCENTS.map((_, i) => themeForLevel(i + 1).accent)
    expect(new Set(accents).size).toBe(5)
  })

  it('the default theme is the L1 midnight-cyan palette', () => {
    expect(DEFAULT_THEME.name).toBe('midnight-cyan')
    expect(DEFAULT_THEME.accent).toBe('#00e5ff')
    expect(DEFAULT_THEME.palette.head).toBe('#00e5ff')
  })
})
