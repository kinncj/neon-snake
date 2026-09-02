import { describe, expect, it } from "vitest";
import { walkFromCell } from "../../app/adapters/render/snake-walk";

/**
 * Regression guard for the "flickering tail" bug: the body array is
 * preallocated to the full grid, so `body[bodyLen]` is a *stale* cell (never
 * undefined). The tail must be detected by index and extrapolated, not by
 * reading that stale cell.
 */
describe("walkFromCell (smooth-walk 'from' cell)", () => {
  // A 5-segment horizontal snake moving right: head (5,3) … tail (1,3).
  // body[5]/body[6] are preallocated STALE cells that must never be read.
  const body = [
    { x: 5, y: 3 },
    { x: 4, y: 3 },
    { x: 3, y: 3 },
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 9, y: 9 }, // stale — the old bug read this for the tail
    { x: 0, y: 0 } // stale
  ];
  const n = 5;

  it("the head glides from its neck (the cell behind)", () => {
    expect(walkFromCell(body, n, 0)).toEqual({ x: 4, y: 3 });
  });

  it("a mid segment glides from the cell behind it", () => {
    expect(walkFromCell(body, n, 2)).toEqual({ x: 2, y: 3 }); // body[3]
    expect(walkFromCell(body, n, 3)).toEqual({ x: 1, y: 3 }); // body[4]
  });

  it("the tail extrapolates one step beyond, NOT the stale cell", () => {
    // Tail (1,3), cell behind (2,3) → extrapolate to (0,3).
    const from = walkFromCell(body, n, 4);
    expect(from).toEqual({ x: 0, y: 3 });
    // The stale cell at body[5] is (9,9); the regression would have returned
    // (9,9) instead of the extrapolated (0,3).
    expect(from).not.toEqual({ x: 9, y: 9 });
    expect(from.y).toBe(3);
  });
});
