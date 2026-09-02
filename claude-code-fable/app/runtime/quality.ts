/**
 * Quality tiers and the frame-time governor.
 *
 *  low     2D integer-scaled composite only.
 *  high    engine layer: snake/food/grid/particles, camera shake + flash.
 *  ultra   high + CRT scanline overlay, radial vignette, luminance flicker.
 *  reduced low visuals, static: no shake, no flash, no displacement.
 *
 * A capability probe picks the start tier; a rolling-median governor moves
 * it at runtime. `prefers-reduced-motion` or the user's Effects toggle force
 * `reduced` and override everything performance-derived.
 */
export type Tier = "low" | "high" | "ultra" | "reduced";

/** Performance-derived tiers, in escalation order. */
export const LADDER: readonly Tier[] = ["low", "high", "ultra"];

export interface Capabilities {
  webgl2: boolean;
  maxTextureSize: number;
  hardwareConcurrency: number;
}

/** Start tier from a capability probe. */
export function tierForCapabilities(c: Capabilities): Tier {
  if (!c.webgl2) return "low";
  if (c.maxTextureSize >= 8192 && c.hardwareConcurrency >= 8) return "ultra";
  if (c.maxTextureSize >= 4096 && c.hardwareConcurrency >= 4) return "high";
  return "low";
}

/** Probes the browser. Never throws; a failed probe reads as no WebGL2. */
export function probeCapabilities(doc: Document, nav: Navigator): Capabilities {
  let webgl2 = false;
  let maxTextureSize = 0;
  try {
    const c = doc.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (gl) {
      webgl2 = true;
      maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    }
  } catch {
    webgl2 = false;
  }
  return { webgl2, maxTextureSize, hardwareConcurrency: nav.hardwareConcurrency || 2 };
}

export const GOVERNOR_WINDOW = 120;
export const GOVERNOR_MIN_GAP = 180;
export const DEESCALATE_MS = 18;
export const ESCALATE_MS = 11;

export interface Governor {
  /** Feed one frame time; returns the (possibly new) tier. */
  sample(frameMs: number): Tier;
  tier(): Tier;
  /** The performance-derived tier, ignoring any forced override. */
  autoTier(): Tier;
  /** Force `reduced` (reduced-motion preference or the Effects toggle). */
  setForcedReduced(on: boolean): void;
  /** Pin a tier (debug/tests); null clears the pin. */
  pin(t: Tier | null): void;
  /** Median of the current window, or 0 before it fills. */
  median(): number;
  /** Frames since the last change. */
  frames(): number;
}

export function createGovernor(start: Tier, opts: { max?: Tier } = {}): Governor {
  const maxIdx = LADDER.indexOf(opts.max ?? "ultra");
  const window = new Float32Array(GOVERNOR_WINDOW);
  const sorted = new Float32Array(GOVERNOR_WINDOW);
  let filled = 0;
  let cursor = 0;
  let idx = Math.max(0, LADDER.indexOf(start === "reduced" ? "low" : start));
  let sinceChange = 0;
  let forced = false;
  let pinned: Tier | null = null;

  const auto = (): Tier => LADDER[Math.min(idx, maxIdx)]!;
  const current = (): Tier => (pinned !== null ? pinned : forced ? "reduced" : auto());

  const median = (): number => {
    if (filled < GOVERNOR_WINDOW) return 0;
    sorted.set(window);
    sorted.sort();
    return sorted[GOVERNOR_WINDOW >> 1]!;
  };

  return {
    sample(frameMs) {
      window[cursor] = frameMs;
      cursor = (cursor + 1) % GOVERNOR_WINDOW;
      if (filled < GOVERNOR_WINDOW) filled++;
      sinceChange++;
      if (pinned === null && filled === GOVERNOR_WINDOW && sinceChange >= GOVERNOR_MIN_GAP) {
        const m = median();
        if (m > DEESCALATE_MS && idx > 0) {
          idx--;
          sinceChange = 0;
        } else if (m < ESCALATE_MS && idx < maxIdx) {
          idx++;
          sinceChange = 0;
        }
      }
      return current();
    },
    tier: current,
    autoTier: auto,
    setForcedReduced(on) {
      forced = on;
    },
    pin(t) {
      pinned = t;
      if (t !== null && t !== "reduced") {
        idx = LADDER.indexOf(t);
        sinceChange = 0;
      }
    },
    median,
    frames: () => sinceChange
  };
}

/** Whether the OS asks for reduced motion. */
export function prefersReducedMotion(win: Window): boolean {
  try {
    return win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
