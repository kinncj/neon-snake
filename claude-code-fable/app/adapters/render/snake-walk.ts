import { type State, cellX, cellY } from "../../domain/types";

/**
 * Smooth walk: every segment glides from where it was last tick to where
 * it is now, by `alpha`. The domain keeps no history, but the body itself
 * is the history: segment i was at body[i+1] one tick ago. The tail has no
 * successor, so it is detected **by index** (i === bodyLen - 1) and
 * extrapolated along the direction from the segment ahead of it; on a
 * growth tick the tail stays put. Reading body[bodyLen] instead would hit
 * a stale preallocated cell and drag the tail toward (0,0).
 */
export interface WalkOut {
  x: number;
  y: number;
}

export function walkFromCell(body: Uint16Array, bodyLen: number, i: number, alpha: number, grew: boolean, out: WalkOut): WalkOut {
  const cur = body[i]!;
  const cx = cellX(cur);
  const cy = cellY(cur);
  let px: number;
  let py: number;
  if (i < bodyLen - 1) {
    const prev = body[i + 1]!;
    px = cellX(prev);
    py = cellY(prev);
  } else if (grew || bodyLen < 2) {
    // The tail did not move this tick.
    out.x = cx;
    out.y = cy;
    return out;
  } else {
    // Tail: it came from one cell further along the direction ahead→tail.
    const ahead = body[i - 1]!;
    px = cx + (cx - cellX(ahead));
    py = cy + (cy - cellY(ahead));
  }
  // Only glide across a single-cell step; anything else (restart, teleport) snaps.
  if (Math.abs(cx - px) + Math.abs(cy - py) !== 1) {
    out.x = cx;
    out.y = cy;
    return out;
  }
  out.x = px + (cx - px) * alpha;
  out.y = py + (cy - py) * alpha;
  return out;
}

/** Tracks tick edges so renderers know whether the last tick grew the snake. */
export interface WalkTracker {
  tick: number;
  bodyLen: number;
  grew: boolean;
}

export function createWalkTracker(): WalkTracker {
  return { tick: -1, bodyLen: 0, grew: false };
}

/** Call once per frame before drawing; returns true when the last tick grew the body. */
export function trackGrowth(tr: WalkTracker, s: State): boolean {
  if (s.tick !== tr.tick) {
    // The first observation is a baseline, not a growth tick.
    tr.grew = tr.tick >= 0 && s.tick === tr.tick + 1 && s.bodyLen > tr.bodyLen;
    tr.tick = s.tick;
    tr.bodyLen = s.bodyLen;
  }
  return tr.grew;
}
