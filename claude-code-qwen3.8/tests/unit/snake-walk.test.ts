import { describe, expect, it } from 'vitest'
import { walkFromCell, walkSegment, type WalkBody } from '../../app/adapters/render/snake-walk'

// P4.1 — the tail-flicker fix. The bug: the FX tail read the preallocated slot
// one PAST the body (`body[len]`), which is never `undefined` on a fixed-length
// Int32Array (it holds a stale value, often (0,0)), yanking the tail toward a
// garbage cell every tick. The fix detects the tail BY INDEX (`i === len - 1`)
// and, on a growth tick, holds it static — never a stale-slot read.
//
// The body is head-first (index 0 = head, index len-1 = tail) and advances by
// index each tick, so a segment's "from" cell is the one BEHIND it (`body[i+1]`);
// the tail has no cell behind and must not read `body[len]`.

// Build a WalkBody whose preallocated slots past `len` hold a STALE value (here
// (0,0), the classic garbage that pulled the tail), so a stale-slot read is
// detectable in the assertions.
function body(cells: ReadonlyArray<readonly [number, number]>, stale = 0): WalkBody {
  const cap = Math.max(16, cells.length + 2) // preallocate past the body, like the real buffer
  const x = new Int32Array(cap).fill(stale)
  const y = new Int32Array(cap).fill(stale)
  let i = 0
  for (const [cx, cy] of cells) {
    x[i] = cx
    y[i] = cy
    i += 1
  }
  return { x, y, len: cells.length }
}

describe('walkFromCell', () => {
  it('a non-tail segment glides from the cell behind it (body[i+1])', () => {
    // head-first, moving right: head (3,10), tail (5,10).
    const b = body([[3, 10], [4, 10], [5, 10]])
    // Segment 1 (not the tail): from-cell is the cell behind = body[2].
    expect(walkFromCell(b, 1, b.len)).toEqual({ x: 5, y: 10 })
    // The head (i = 0): from-cell is the cell behind the head = body[1].
    expect(walkFromCell(b, 0, b.len)).toEqual({ x: 4, y: 10 })
  })

  it('a steady-state tail extrapolates one step back along its trailing direction', () => {
    // len === prevLen (no growth this tick): the tail is steady, not fresh.
    const b = body([[3, 10], [4, 10], [5, 10]], 0)
    const tail = walkFromCell(b, b.len - 1, b.len)
    // From the neighbour ahead (4,10) extended past the tail (5,10) -> (6,10).
    expect(tail).toEqual({ x: 6, y: 10 })
  })

  it('a freshly-grown tail holds static, not the stale preallocated slot (the flicker fix)', () => {
    // Grew this tick: prevLen = len - 1. The new tail is the index one past the
    // previous length. The preallocated slot at index len holds a STALE (0,0).
    const b = body([[3, 10], [4, 10], [5, 10], [6, 10]], 0)
    const prevLen = b.len - 1 // 3
    const tail = walkFromCell(b, b.len - 1, prevLen) // i = 3 >= prevLen -> static
    // The from-cell is the tail's OWN cell — NOT the stale (0,0) at index 4.
    expect(tail).toEqual({ x: 6, y: 10 })
    // Guard the actual bug: a naive read of body[len] would be (0,0).
    expect(b.x[b.len]).toBe(0) // the stale slot really is (0,0) here
    expect(tail.x).not.toBe(0)
    expect(tail.y).not.toBe(0)
  })

  it('never reads the stale slot past the body, for a non-zero stale value', () => {
    // Use a recognizable stale value (999) past the body so a stray read is
    // unambiguous. Both a fresh tail (static) and a steady tail (extrapolated)
    // must avoid it.
    const fresh = body([[3, 10], [4, 10], [5, 10], [6, 10]], 999)
    expect(walkFromCell(fresh, fresh.len - 1, fresh.len - 1).x).not.toBe(999)
    const steady = body([[3, 10], [4, 10], [5, 10]], 999)
    expect(walkFromCell(steady, steady.len - 1, steady.len).x).not.toBe(999)
  })

  it('a length-1 body (head is also the tail) holds static', () => {
    const b = body([[7, 7]], 0)
    expect(walkFromCell(b, 0, 0)).toEqual({ x: 7, y: 7 }) // i >= prevLen (0 >= 0)
  })
})

describe('walkSegment', () => {
  it('interpolates from-cell -> current cell by alpha (0 -> from, 1 -> current)', () => {
    const b = body([[3, 10], [4, 10], [5, 10]], 0)
    const prevLen = b.len
    // The tail's from-cell is (6,10) (extrapolated); current cell is (5,10).
    expect(walkSegment(b, b.len - 1, prevLen, 0)).toEqual({ x: 6, y: 10 })
    expect(walkSegment(b, b.len - 1, prevLen, 1)).toEqual({ x: 5, y: 10 })
    expect(walkSegment(b, b.len - 1, prevLen, 0.5)).toEqual({ x: 5.5, y: 10 })
  })

  it('a freshly-grown tail stays put for every alpha (no flicker)', () => {
    const b = body([[3, 10], [4, 10], [5, 10], [6, 10]], 0)
    const prevLen = b.len - 1
    for (const a of [0, 0.25, 0.5, 0.75, 1]) {
      expect(walkSegment(b, b.len - 1, prevLen, a)).toEqual({ x: 6, y: 10 })
    }
  })

  it('with no previous snapshot (prevLen 0, e.g. the title screen) every segment is static', () => {
    // Before the first step, capturePrev has not run and prevBodyLen is 0. The
    // head must sit at its OWN cell (not glide from the neck, body[1]) for every
    // alpha — otherwise at alpha 0 it lands on the neck's cell.
    const b = body([[3, 10], [4, 10], [5, 10]], 0)
    for (const i of [0, 1, 2]) {
      for (const a of [0, 0.5, 1]) {
        const seg = walkSegment(b, i, 0, a)
        expect(seg).toEqual({ x: b.x[i], y: b.y[i] })
      }
    }
    // Specifically the head (i 0) is at its cell, not the neck (body[1]).
    expect(walkSegment(b, 0, 0, 0).x).toBe(3)
    expect(walkSegment(b, 0, 0, 0).x).not.toBe(4)
  })
})
