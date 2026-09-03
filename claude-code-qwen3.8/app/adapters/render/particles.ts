// Fixed-capacity particle ring buffer. Presentation-only: it never reads or
// writes domain state. All buffers are preallocated at full capacity so the
// per-frame update path allocates nothing (the "zero steady-state allocation"
// budget). Coordinates are framebuffer pixels (FRAME_W x FRAME_H).
//
// Velocities are derived deterministically from the particle slot index (a
// 32-bit scramble hash) rather than Math.random, so a burst at a given slot is
// reproducible — the unit tests pin exact trajectories.
//
// The renderers (the 2D framebuffer composite and the Phaser FX layer) both
// read from the same system, so a burst is visible on the guaranteed 2D
// fallback as well as on the engine.

import { FRAME_W, FRAME_H } from '../../domain/types'

export const PARTICLE_CAP: number = 512
/** Default life for a burst particle (ms). */
export const DEFAULT_LIFE_MS: number = 600
/** Default burst speed (px/s at framebuffer scale). */
export const DEFAULT_SPEED: number = 90

const TAU = Math.PI * 2

/** Scramble a 32-bit int to a float in [0, 1) — deterministic per slot. */
function slot01(slot: number): number {
  let h = (slot + 1) * 0x9e3779b9
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export interface BurstOpts {
  /** Launch speed in px/s (framebuffer scale). Default 90. */
  speed?: number
  /** Particle life in ms. Default 600. */
  lifeMs?: number
  /** Particle radius in framebuffer px. Default 1.5. */
  size?: number
  /** Particle colour as 0-255 RGB. Default [255, 255, 255]. */
  color?: readonly [number, number, number]
  /** Centre angle in radians (0 = +x). Ignored if angleSpread is unset. */
  angleCenter?: number
  /** Total angular spread in radians. Unset = full circle. */
  angleSpread?: number
}

export class ParticleSystem {
  private readonly px = new Float32Array(PARTICLE_CAP)
  private readonly py = new Float32Array(PARTICLE_CAP)
  private readonly vx = new Float32Array(PARTICLE_CAP)
  private readonly vy = new Float32Array(PARTICLE_CAP)
  private readonly life = new Float32Array(PARTICLE_CAP)
  private readonly maxLife = new Float32Array(PARTICLE_CAP)
  private readonly size = new Float32Array(PARTICLE_CAP)
  private readonly cr = new Uint8Array(PARTICLE_CAP)
  private readonly cg = new Uint8Array(PARTICLE_CAP)
  private readonly cb = new Uint8Array(PARTICLE_CAP)
  private readonly alive = new Uint8Array(PARTICLE_CAP)
  private head = 0

  /** Number of live particles. */
  active = 0

  /**
   * Spawn `count` particles at (x, y). Slots wrap at PARTICLE_CAP; when the
   * buffer is full the oldest slot (the next one to be overwritten) is evicted.
   * Returns the number actually spawned (<= count).
   */
  burst(x: number, y: number, count: number, opts: BurstOpts = {}): number {
    const speed = (opts.speed ?? DEFAULT_SPEED) / 1000 // px/ms
    const lifeMs = opts.lifeMs ?? DEFAULT_LIFE_MS
    const size = opts.size ?? 1.5
    const color = opts.color ?? ([255, 255, 255] as const)
    const fullCircle = opts.angleSpread === undefined
    const center = opts.angleCenter ?? 0
    const spread = opts.angleSpread ?? TAU

    let spawned = 0
    for (let k = 0; k < count; k++) {
      const slot = this.head
      // Evict the occupant (if any) before reusing the slot.
      if (this.alive[slot]) this.active--
      this.alive[slot] = 1
      this.active++

      this.px[slot] = x
      this.py[slot] = y
      // Angle: even distribution across the spread (or a full circle).
      const frac = (k + 0.5) / count
      const angle = fullCircle ? frac * TAU : center - spread / 2 + frac * spread
      // Per-slot speed jitter in [0.6, 1.0] of the nominal speed.
      const jitter = 0.6 + 0.4 * slot01(slot)
      this.vx[slot] = Math.cos(angle) * speed * jitter
      this.vy[slot] = Math.sin(angle) * speed * jitter
      this.life[slot] = lifeMs
      this.maxLife[slot] = lifeMs
      this.size[slot] = size
      this.cr[slot] = color[0]
      this.cg[slot] = color[1]
      this.cb[slot] = color[2]

      this.head = (slot + 1) % PARTICLE_CAP
      spawned++
    }
    return spawned
  }

  /** Advance the simulation by dtMs; retires expired particles. No allocation. */
  update(dtMs: number): void {
    if (dtMs <= 0) return
    for (let i = 0; i < PARTICLE_CAP; i++) {
      if (!this.alive[i]) continue
      const life = (this.life[i] ?? 0) - dtMs
      this.life[i] = life
      if (life <= 0) {
        this.alive[i] = 0
        this.active--
        continue
      }
      this.px[i] = (this.px[i] ?? 0) + (this.vx[i] ?? 0) * dtMs
      this.py[i] = (this.py[i] ?? 0) + (this.vy[i] ?? 0) * dtMs
    }
  }

  /**
   * Visit every live particle. `fn` receives the slot index; read the fields
   * via the accessors below. The renderer controls the draw, this controls
   * nothing.
   */
  forEachLive(fn: (i: number) => void): void {
    for (let i = 0; i < PARTICLE_CAP; i++) if (this.alive[i]) fn(i)
  }

  aliveAt(i: number): boolean {
    return this.alive[i] === 1
  }
  xAt(i: number): number {
    return this.px[i] ?? 0
  }
  yAt(i: number): number {
    return this.py[i] ?? 0
  }
  sizeAt(i: number): number {
    return this.size[i] ?? 0
  }
  /** Remaining life as an alpha in [0, 1] (1 = just spawned). */
  alphaAt(i: number): number {
    const ml = this.maxLife[i] ?? 0
    return ml > 0 ? Math.max(0, (this.life[i] ?? 0) / ml) : 0
  }
  colorAt(i: number, out: [number, number, number]): [number, number, number] {
    out[0] = this.cr[i] ?? 0
    out[1] = this.cg[i] ?? 0
    out[2] = this.cb[i] ?? 0
    return out
  }

  /** Retire all particles (e.g. on restart). */
  reset(): void {
    this.alive.fill(0)
    this.active = 0
  }

  /** Clamp a point to the framebuffer (used by renderers for safety). */
  static clampX(x: number): number {
    return x < 0 ? 0 : x > FRAME_W ? FRAME_W : x
  }
  static clampY(y: number): number {
    return y < 0 ? 0 : y > FRAME_H ? FRAME_H : y
  }
}
