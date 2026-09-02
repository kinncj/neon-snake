// The fixed-timestep runtime loop. It converts injected wall-clock time into a
// bounded number of fixed simulation steps plus a sub-tick `alpha` for render
// interpolation. It lives here (not the domain): the domain steps one tick at a
// time and never measures wall-clock; the per-level tick interval is a config
// value the runtime picks (see tickMs).
export const MAX_CATCHUP = 5

export class FixedTimestepLoop {
  private acc = 0
  private last = 0
  private started = false
  private readonly onTick: () => void
  tickMs: number

  constructor(tickMs: number, onTick: () => void) {
    this.tickMs = tickMs
    this.onTick = onTick
  }

  /** Reset the clock so no delta is banked (after a restart/resume). */
  reset(): void {
    this.acc = 0
    this.last = 0
    this.started = false
  }

  /**
   * Advance by the given wall-clock timestamp (ms). Runs at most MAX_CATCHUP
   * fixed steps (clamping a huge delta) and returns the interpolation alpha in
   * [0, 1).
   */
  update(now: number): number {
    if (!this.started) {
      this.started = true
      this.last = now
      return 0
    }
    let dt = now - this.last
    this.last = now
    if (dt < 0) dt = 0
    const maxFrame = this.tickMs * MAX_CATCHUP
    if (dt > maxFrame) dt = maxFrame
    this.acc += dt
    let ticks = 0
    while (this.acc >= this.tickMs && ticks < MAX_CATCHUP) {
      this.acc -= this.tickMs
      this.onTick()
      ticks++
    }
    if (this.acc >= this.tickMs) this.acc = 0 // over budget: drop the remainder
    return this.acc / this.tickMs
  }
}
