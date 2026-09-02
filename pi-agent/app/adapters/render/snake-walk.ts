/**
 * Per-segment "from" cell for the smooth-walk interpolation. Pure, and unit
 * tested so the tail can never silently regress to reading a *stale* body
 * cell.
 *
 * Each segment glides from the cell of the segment *behind* it to its own
 * cell. For the tail, the cell behind has left the live body. The body array
 * is **preallocated** (sized to the full grid), so `body[bodyLen]` is a stale
 * cell — never `undefined` — which means the tail must be detected by *index*
 * (not an `undefined` check) and extrapolated one step beyond along its own
 * direction. Reading the stale cell is what made the tail flicker toward the
 * top-left corner with the FX layer on.
 */
export interface SnakeCell {
  readonly x: number;
  readonly y: number;
}

/** The "from" (previous-tick) cell that segment `i` glides from. */
export function walkFromCell(
  body: readonly SnakeCell[],
  bodyLen: number,
  i: number
): { readonly x: number; readonly y: number } {
  if (i === bodyLen - 1) {
    // Tail: the cell behind has left the live body; extrapolate one step
    // beyond along the tail's direction.
    const cell = body[i]!;
    const behind = body[i - 1]!;
    return { x: 2 * cell.x - behind.x, y: 2 * cell.y - behind.y };
  }
  // The segment behind (i + 1 < bodyLen) is a live cell.
  return body[i + 1]!;
}
