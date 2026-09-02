import { describe, expect, it } from 'vitest'
import {
  COMBO_WINDOW_TICKS,
  foodValueForLevel,
  levelForScore,
  LEVEL_SCORES,
  LEVEL_TICK_MS,
  MAX_COMBO,
  MAX_LEVEL,
  tickMsForLevel,
} from '../../app/domain/levels'

describe('levels', () => {
  it('score maps to a 1..5 level at the thresholds', () => {
    expect(levelForScore(0)).toBe(1)
    expect(levelForScore(149)).toBe(1)
    expect(levelForScore(150)).toBe(2)
    expect(levelForScore(399)).toBe(2)
    expect(levelForScore(400)).toBe(3)
    expect(levelForScore(799)).toBe(3)
    expect(levelForScore(800)).toBe(4)
    expect(levelForScore(1499)).toBe(4)
    expect(levelForScore(1500)).toBe(5)
    expect(levelForScore(99999)).toBe(5) // capped at the top
  })

  it('MAX_LEVEL equals the number of thresholds', () => {
    expect(MAX_LEVEL).toBe(LEVEL_SCORES.length)
    expect(MAX_LEVEL).toBe(5)
  })

  it('food values rise with the level', () => {
    expect(foodValueForLevel(1)).toBe(10)
    expect(foodValueForLevel(2)).toBe(10)
    expect(foodValueForLevel(3)).toBe(20)
    expect(foodValueForLevel(4)).toBe(20)
    expect(foodValueForLevel(5)).toBe(40)
  })

  it('the tick interval falls as the level rises (L1 = 120ms base)', () => {
    expect(tickMsForLevel(1)).toBe(120)
    expect(tickMsForLevel(2)).toBe(105)
    expect(tickMsForLevel(5)).toBe(74)
    expect(tickMsForLevel(99)).toBe(74) // clamped
    expect(LEVEL_TICK_MS[0]).toBe(120)
    expect(COMBO_WINDOW_TICKS).toBe(6)
    expect(MAX_COMBO).toBe(4)
  })
})
