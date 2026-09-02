// Fixed-capacity particle pool for the FX layer.
//
// A preallocated ring of PARTICLE_CAP particles; overflow evicts the oldest
// live particle (newest input wins, like the intent queue). Particles live in
// cell coordinates (the 32x30 grid space) and the FX shader maps them onto
// the screen-aligned field quad — so particle motion is resolution
// independent.
//
// Zero steady-state allocation: the pool, the integration scratch, and the
// vertex buffer are all preallocated and reused. `burst()` spawns in place.

import { GRID_H, GRID_W } from "../../../domain/types";

export const PARTICLE_CAP = 512;

export interface BurstOptions {
  /** Centre of the angular distribution (radians, 0 = +x / rightward). */
  angleCenter?: number;
  /** Half-spread of the angular distribution (radians). */
  angleSpread?: number;
  /** Launch speed in cells/second (range [min,max]). */
  speed?: [number, number];
  /** Lifetime in ms (range [min,max]). */
  life?: [number, number];
  /** Size in cells (range [min,max]). */
  size?: [number, number];
  /** RGBA colour (0..255) per particle. */
  color?: [number, number, number, number];
  /** Gravity in cells/s^2 (positive = down). */
  gravity?: number;
  /** Deterministic RNG seed (xorshift32 state); 0 -> no randomness, the
   * distribution is evenly spread instead. */
  seed?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
  active: boolean;
}

/**
 * Ring-buffer particle pool. Coordinates are in cells; the pool is a
 * presentation concern and knows nothing about the simulation state.
 */
export class ParticlePool {
  private readonly pool: Particle[] = [];
  /** Preallocated vertex scratch: up to CAP quads, 6 floats each
   * (x, y, size, r, g, b) — alpha is folded into the vertex at upload. */
  readonly verts: Float32Array = new Float32Array(PARTICLE_CAP * 6);
  private head = 0; // index of the oldest particle
  private live = 0;
  private grav = 0;

  constructor() {
    for (let i = 0; i < PARTICLE_CAP; i++) {
      this.pool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        size: 0,
        r: 255,
        g: 255,
        b: 255,
        a: 255,
        active: false
      });
    }
  }

  get count(): number {
    return this.live;
  }

  /** All particles dead? (steady state for the zero-allocation budget) */
  get idle(): boolean {
    return this.live === 0;
  }

  private slot(): Particle {
    // Full ring: evict the oldest (advance the head), reuse that slot.
    if (this.live === PARTICLE_CAP) {
      const old = this.pool[this.head]!;
      old.active = false;
      this.head = (this.head + 1) % PARTICLE_CAP;
      this.live--;
    }
    // Slot at (head + live) is the next free/evicted one.
    const idx = (this.head + this.live) % PARTICLE_CAP;
    this.live++;
    return this.pool[idx]!;
  }

  /**
   * Spawn `count` particles at (x, y) in cell space. With a seed, angles and
   * magnitudes draw from a local xorshift32 (deterministic bursts); without
   * one they are evenly spread across the distribution.
   */
  burst(
    count: number,
    x: number,
    y: number,
    opts: BurstOptions = {}
  ): void {
    const angleCenter = opts.angleCenter ?? 0;
    const angleSpread = opts.angleSpread ?? Math.PI;
    const [speedMin, speedMax] = opts.speed ?? [4, 9];
    const [lifeMin, lifeMax] = opts.life ?? [260, 620];
    const [sizeMin, sizeMax] = opts.size ?? [0.35, 0.8];
    const [r, g, b, a] = opts.color ?? [0, 229, 255, 255];
    this.grav = opts.gravity ?? 0;
    let rng = opts.seed ?? 0;

    for (let i = 0; i < count; i++) {
      let u1: number;
      let u2: number;
      let u3: number;
      if (rng !== 0) {
        rng = (rng ^ (rng << 13)) >>> 0;
        rng = (rng ^ (rng >>> 17)) >>> 0;
        rng = (rng ^ (rng << 5)) >>> 0;
        if (rng === 0) rng = 0x42021;
        u1 = rng / 0x100000000;
        rng = (rng ^ (rng << 13)) >>> 0;
        rng = (rng ^ (rng >>> 17)) >>> 0;
        rng = (rng ^ (rng << 5)) >>> 0;
        if (rng === 0) rng = 0x42021;
        u2 = rng / 0x100000000;
        u3 = i / count;
      } else {
        u1 = i / count;
        u2 = (i + 0.5) / count;
        u3 = (i * 0.61803398875) % 1; // golden-ratio scatter
      }
      const p = this.slot();
      const angle =
        angleCenter + (u1 * 2 - 1) * angleSpread;
      const speed = speedMin + u2 * (speedMax - speedMin);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = lifeMin + u3 * (lifeMax - lifeMin);
      p.maxLife = p.life;
      p.size = sizeMin + u1 * (sizeMax - sizeMin);
      p.r = r;
      p.g = g;
      p.b = b;
      p.a = a;
      p.active = true;
    }
  }

  /** Integrate one frame (dt in ms). Dead particles are skipped in place. */
  update(dtMs: number): void {
    if (this.live === 0 || dtMs <= 0) return;
    const dt = Math.min(dtMs, 50) / 1000; // clamp: a hiccup can't fling them
    for (let i = 0; i < PARTICLE_CAP; i++) {
      const p = this.pool[i]!;
      if (!p.active) continue;
      p.life -= dtMs;
      if (p.life <= 0) {
        p.active = false;
        this.live--;
        continue;
      }
      // Cell y grows downward, so positive gravity adds to vy.
      p.vy += this.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Die on wall contact (sparks bounce off nothing; they just end).
      if (p.x < -0.5 || p.x > GRID_W + 0.5 || p.y < -0.5 || p.y > GRID_H + 0.5) {
        p.active = false;
        this.live--;
      }
    }
  }

  /**
   * Flatten live particles into the preallocated vertex scratch. Returns the
   * number of vertices written (6 floats per particle, one quad). Life fade
   * is folded into the colour alpha so the shader needs no per-particle
   * lifetime.
   */
  writeVerts(): number {
    let n = 0;
    for (let i = 0; i < PARTICLE_CAP; i++) {
      const p = this.pool[i]!;
      if (!p.active) continue;
      const fade = Math.min(1, p.life / p.maxLife);
      const o = n * 6;
      this.verts[o] = p.x;
      this.verts[o + 1] = p.y;
      this.verts[o + 2] = p.size;
      this.verts[o + 3] = (p.r / 255) * fade;
      this.verts[o + 4] = (p.g / 255) * fade;
      this.verts[o + 5] = (p.b / 255) * fade;
      n++;
    }
    return n;
  }

  clear(): void {
    for (let i = 0; i < PARTICLE_CAP; i++) this.pool[i]!.active = false;
    this.live = 0;
  }
}
