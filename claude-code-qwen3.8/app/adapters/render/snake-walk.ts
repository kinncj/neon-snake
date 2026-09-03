// Pure smooth-walk interpolation (P4.1 — the tail-flicker fix). No DOM, no
// timers, no Math.random: a function over integer body cells that both the 2D
// ground-truth composite and the FX renderer call so the two paths agree on the
// glide.
//
// A snake segment glides from its "from" cell to its current cell by `alpha`.
// Because the body is head-first and advances by index (each tick each segment
// takes the cell ahead — `step.ts` shifts `body[i] = body[i-1]`), a segment's
// from-cell is the one BEHIND it: `body[i+1]`. The tail is the one exception —
// it has no cell behind. Naively reading `body[bodyLen]` there hits a stale
// preallocated Int32Array slot (a fixed-length buffer is never `undefined`
// past `len`), which yanked the FX tail toward a garbage cell (often (0,0)) each
// tick and made it flicker. The fix: detect the tail BY INDEX (`i === len - 1`).
// A freshly-grown tail (the index one past the previous length) holds static; a
// steady-state tail extrapolates one step back along its trailing direction.
// Never a stale-slot read.
export interface WalkBody {
  x: Int32Array
  y: Int32Array
  len: number
}

/**
 * The grid-space "from" cell (integer for non-tail, fractional after the tail
 * extrapolation) that segment `i` glides from. `prevLen` is the previous tick's
 * body length — used to tell a freshly-grown tail (which holds static) from a
 * steady one (which extrapolates). Head-first: `body.x[0]` is the head,
 * `body.x[len-1]` is the tail.
 */
export function walkFromCell(
  body: WalkBody,
  i: number,
  prevLen: number,
): { x: number; y: number } {
  const cx = body.x[i] ?? 0
  const cy = body.y[i] ?? 0
  if (i < body.len - 1) {
    // Not the tail: the cell behind — this segment's previous position.
    return { x: body.x[i + 1] ?? 0, y: body.y[i + 1] ?? 0 }
  }
  // The tail (`i === len - 1`): there is no cell behind it.
  if (i >= prevLen) {
    // Freshly grown: no previous cell here yet — hold static. Do NOT read the
    // stale preallocated cell behind it (that was the flicker).
    return { x: cx, y: cy }
  }
  // Steady-state tail: extrapolate one step back along the trailing direction
  // (from the neighbour ahead, extended past the tail).
  const ax = body.x[i - 1] ?? cx
  const ay = body.y[i - 1] ?? cy
  return { x: cx + (cx - ax), y: cy + (cy - ay) }
}

/**
 * A segment's interpolated (grid) position between its from-cell and its
 * current cell, by `alpha` in [0,1]. This is what each renderer actually draws.
 *
 * When `prevLen` is 0 there is no previous snapshot yet (the first frame / the
 * title screen, before any step has captured one): there is no "from" cell to
 * glide from, so EVERY segment sits at its current cell (static). Without this,
 * the head would glide from `body[1]` (the neck) and at `alpha = 0` land on the
 * neck's cell instead of the head's.
 */
export function walkSegment(
  body: WalkBody,
  i: number,
  prevLen: number,
  alpha: number,
): { x: number; y: number } {
  const cx = body.x[i] ?? 0
  const cy = body.y[i] ?? 0
  if (prevLen === 0) {
    // No previous snapshot yet: draw static (no from-cell to glide from).
    return { x: cx, y: cy }
  }
  const from = walkFromCell(body, i, prevLen)
  return { x: from.x + (cx - from.x) * alpha, y: from.y + (cy - from.y) * alpha }
}
