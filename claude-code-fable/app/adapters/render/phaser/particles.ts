/**
 * Fixed-capacity particle ring. Every field is a preallocated typed array;
 * a burst past capacity overwrites the oldest slots. Positions are in
 * screen pixels; the renderer draws whatever is alive each frame.
 */
export const PARTICLE_CAP = 512;

export interface Particles {
  readonly cap: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Remaining life in ms; <= 0 means dead. */
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array;
  colour: Uint32Array;
  /** Per-particle gravity in px/s^2. */
  gravity: Float32Array;
  /** Next slot to write (ring cursor). */
  cursor: number;
  /** Alive count after the last update. */
  alive: number;
  /** Deterministic xorshift state for spread/speed jitter. */
  seed: number;
}

export interface BurstOptions {
  count: number;
  /** Base speed in px/s and its jitter fraction (0..1). */
  speed: number;
  speedJitter?: number;
  /** Life in ms and its jitter fraction. */
  life: number;
  lifeJitter?: number;
  /** Centre of the emission cone in radians (0 = +x, clockwise on screen). */
  angleCenter?: number;
  /** Half-width of the cone in radians; PI for a full circle. */
  angleSpread?: number;
  size: number;
  colour: number;
  gravity?: number;
}

export function createParticles(cap = PARTICLE_CAP, seed = 0x2545f491): Particles {
  return {
    cap,
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    vx: new Float32Array(cap),
    vy: new Float32Array(cap),
    life: new Float32Array(cap),
    maxLife: new Float32Array(cap),
    size: new Float32Array(cap),
    colour: new Uint32Array(cap),
    gravity: new Float32Array(cap),
    cursor: 0,
    alive: 0,
    seed
  };
}

function rnd(p: Particles): number {
  let x = p.seed;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  p.seed = x;
  return x / 4294967296;
}

/** Emits `count` particles at (x, y); oldest slots are recycled on overflow. */
export function burst(p: Particles, x: number, y: number, o: BurstOptions): void {
  const center = o.angleCenter ?? 0;
  const spread = o.angleSpread ?? Math.PI;
  const sj = o.speedJitter ?? 0.5;
  const lj = o.lifeJitter ?? 0.4;
  const g = o.gravity ?? 0;
  for (let n = 0; n < o.count; n++) {
    const i = p.cursor;
    p.cursor = (p.cursor + 1) % p.cap;
    const a = center + (rnd(p) * 2 - 1) * spread;
    const sp = o.speed * (1 + (rnd(p) * 2 - 1) * sj);
    const lf = o.life * (1 + (rnd(p) * 2 - 1) * lj);
    p.x[i] = x;
    p.y[i] = y;
    p.vx[i] = Math.cos(a) * sp;
    p.vy[i] = Math.sin(a) * sp;
    p.life[i] = lf;
    p.maxLife[i] = lf;
    p.size[i] = o.size * (0.6 + rnd(p) * 0.8);
    p.colour[i] = o.colour;
    p.gravity[i] = g;
  }
}

/** Integrates every live particle by `dtMs`; returns the alive count. */
export function update(p: Particles, dtMs: number): number {
  const dt = dtMs / 1000;
  let alive = 0;
  for (let i = 0; i < p.cap; i++) {
    const l = p.life[i]!;
    if (l <= 0) continue;
    const nl = l - dtMs;
    p.life[i] = nl;
    if (nl <= 0) continue;
    p.vy[i] = p.vy[i]! + p.gravity[i]! * dt;
    p.x[i] = p.x[i]! + p.vx[i]! * dt;
    p.y[i] = p.y[i]! + p.vy[i]! * dt;
    // Air drag keeps bursts tight.
    p.vx[i] = p.vx[i]! * (1 - 1.8 * dt);
    p.vy[i] = p.vy[i]! * (1 - 1.8 * dt);
    alive++;
  }
  p.alive = alive;
  return alive;
}

export function clear(p: Particles): void {
  p.life.fill(0);
  p.alive = 0;
  p.cursor = 0;
}
