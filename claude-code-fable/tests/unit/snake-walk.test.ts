import { describe, it, expect } from "vitest";
import { walkFromCell, createWalkTracker, trackGrowth } from "../../app/adapters/render/snake-walk";
import { init, step } from "../../app/domain/step";
import { createSink, packCell, cellX, cellY, CELL_COUNT } from "../../app/domain/types";

const out = { x: 0, y: 0 };

describe("walkFromCell", () => {
  it("glides each segment from its successor's cell", () => {
    const body = new Uint16Array(CELL_COUNT);
    body[0] = packCell(10, 5);
    body[1] = packCell(9, 5);
    body[2] = packCell(8, 5);
    body[3] = packCell(8, 6);
    walkFromCell(body, 4, 0, 0.5, false, out);
    expect(out).toEqual({ x: 9.5, y: 5 });
    walkFromCell(body, 4, 2, 0.25, false, out);
    expect(out).toEqual({ x: 8, y: 5.75 });
  });

  it("detects the tail by index and extrapolates, ignoring stale cells past bodyLen", () => {
    const body = new Uint16Array(CELL_COUNT);
    body[0] = packCell(10, 5);
    body[1] = packCell(9, 5);
    body[2] = packCell(8, 5);
    body[3] = packCell(0, 0); // stale preallocated cell: must never be read
    walkFromCell(body, 3, 2, 0.5, false, out);
    expect(out).toEqual({ x: 7.5, y: 5 }); // came from (7,5), heading right
    walkFromCell(body, 3, 2, 0, false, out);
    expect(out).toEqual({ x: 7, y: 5 });
    walkFromCell(body, 3, 2, 1, false, out);
    expect(out).toEqual({ x: 8, y: 5 });
  });

  it("holds the tail static on a growth tick", () => {
    const body = new Uint16Array(CELL_COUNT);
    body[0] = packCell(10, 5);
    body[1] = packCell(9, 5);
    body[2] = packCell(8, 5);
    walkFromCell(body, 3, 2, 0.3, true, out);
    expect(out).toEqual({ x: 8, y: 5 });
  });

  it("snaps when the step is not a single cell (restart)", () => {
    const body = new Uint16Array(CELL_COUNT);
    body[0] = packCell(16, 15);
    body[1] = packCell(3, 3);
    walkFromCell(body, 2, 0, 0.5, false, out);
    expect(out).toEqual({ x: 16, y: 15 });
  });

  it("never drifts toward the origin over a real run", () => {
    const s = init("walk");
    const sink = createSink();
    const tr = createWalkTracker();
    for (let t = 0; t < 200; t++) {
      s.foodX = cellX(s.body[0]!) + 1;
      s.foodY = cellY(s.body[0]!);
      if (s.foodX >= 31) s.foodX = 0;
      step(s, sink);
      if (s.phase !== "playing") break;
      const grew = trackGrowth(tr, s);
      for (let i = 0; i < s.bodyLen; i++) {
        walkFromCell(s.body, s.bodyLen, i, 0.5, grew, out);
        const cx = cellX(s.body[i]!);
        const cy = cellY(s.body[i]!);
        expect(Math.abs(out.x - cx) + Math.abs(out.y - cy)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });
});

describe("trackGrowth", () => {
  it("reports growth only for the tick that grew the body", () => {
    const s = init("grow");
    const sink = createSink();
    const tr = createWalkTracker();
    expect(trackGrowth(tr, s)).toBe(false);
    s.foodX = cellX(s.body[0]!) + 1;
    s.foodY = cellY(s.body[0]!);
    step(s, sink);
    expect(trackGrowth(tr, s)).toBe(true);
    expect(trackGrowth(tr, s)).toBe(true); // same tick, same answer
    s.foodX = 0;
    s.foodY = 0;
    step(s, sink);
    expect(trackGrowth(tr, s)).toBe(false);
  });
});
