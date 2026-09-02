import { describe, expect, it } from 'vitest'
import { computeLayout } from '../../app/adapters/render/framebuffer'
import { FRAME_H, FRAME_W } from '../../app/domain/types'

describe('framebuffer layout', () => {
  it('picks the largest integer scale that fits, centred', () => {
    // 512x480 @1x -> scale 2 (512/256=2, 480/240=2)
    const l = computeLayout(512, 480, 1)
    expect(l.scale).toBe(2)
    expect(l.w).toBe(512)
    expect(l.h).toBe(480)
    expect(l.offX).toBe(0)
    expect(l.offY).toBe(0)
  })

  it('letterboxes the wider axis', () => {
    // 1024x480 @1x: min(1024/256, 480/240) = min(4, 2) = 2 -> 512x480, pillarbox
    const l = computeLayout(1024, 480, 1)
    expect(l.scale).toBe(2)
    expect(l.offX).toBe(Math.floor((1024 - FRAME_W * 2) / 2))
    expect(l.offY).toBe(0)
    // no clipping: the blitted field fits inside the backing store
    expect(l.offX + FRAME_W * l.scale).toBeLessThanOrEqual(l.w)
    expect(l.offY + FRAME_H * l.scale).toBeLessThanOrEqual(l.h)
  })

  it('respects device pixel ratio in the backing store', () => {
    const l = computeLayout(512, 480, 2)
    expect(l.w).toBe(1024)
    expect(l.h).toBe(960)
    expect(l.scale).toBe(4) // (1024/256, 960/240) -> 4
  })

  it('never scales below 1', () => {
    const l = computeLayout(100, 100, 1)
    expect(l.scale).toBe(1)
  })
})
