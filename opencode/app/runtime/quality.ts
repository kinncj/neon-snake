// Runtime quality-tier selection and governance.
//
// The presentation renders at one of four tiers:
//   low     — the 2D composite only (the framebuffer path);
//   high    — the effects path: snake/food/grid/particles + camera
//             shake/flash, bloom, scanline mask, vignette;
//   ultra   — high plus the displacement passes (curvature warp, chromatic
//             aberration, grain, radial shockwave, death dissolve) and the
//             luminance flicker;
//   reduced — low visuals, fully static: no shake, no displacement passes.
//
// The starting tier comes from a one-time capability probe (WebGL2
// availability, MAX_TEXTURE_SIZE, core count). A rolling 120-frame median
// governor then de-escalates when frames run slow (median > 18 ms) and
// escalates when they run fast (median < 11 ms), at most once every 180
// frames, so a brief hiccup never flips the tier. prefers-reduced-motion —
// or the user's Effects toggle — forces `reduced` and overrides any
// performance-derived tier.
//
// Everything except the two probe helpers is pure and steady-state
// allocation-free (the median sorts a reused scratch buffer), so it is
// unit-testable without a browser.

export type Tier = "low" | "high" | "ultra" | "reduced";

/** Post passes enabled per tier. Displacement/warp passes are ultra-only. */
export const TIER_FEATURES: Record<Exclude<Tier, "reduced">, readonly string[]> = {
  low: [],
  high: ["bloom", "scanline", "vignette", "particles"],
  ultra: [
    "bloom",
    "scanline",
    "vignette",
    "particles",
    "curvature",
    "chromatic",
    "grain",
    "shockwave",
    "deathblur"
  ]
};

/** Passes that move pixels off their source position (absent at reduced). */
export const DISPLACEMENT_PASSES: readonly string[] = [
  "curvature",
  "chromatic",
  "shockwave",
  "deathblur"
];

export interface Capabilities {
  readonly webgl2: boolean;
  readonly maxTextureSize: number;
  readonly cores: number;
}

/**
 * Pick the starting tier from a capability probe. No WebGL2 -> low. WebGL2
 * with headroom (large textures, many cores) -> ultra. Otherwise high.
 */
export function pickInitialTier(cap: Capabilities): Tier {
  if (!cap.webgl2) return "low";
  if (cap.maxTextureSize >= 4096 && cap.cores >= 8) return "ultra";
  return "high";
}

/** Rolling-window median frame governor with hysteresis. Pure. */
export class TierGovernor {
  private readonly window: number[] = [];
  /** Reused sort scratch — the median must not allocate per frame. */
  private readonly scratch: number[];
  private readonly windowSize: number;
  private readonly minGap: number;
  private framesSinceChange = 0;
  private perf: Tier;
  private reduced: boolean;

  constructor(initial: Tier, reduced: boolean, windowSize = 120, minGap = 180) {
    this.perf = initial;
    this.reduced = reduced;
    this.windowSize = windowSize;
    this.minGap = minGap;
    this.scratch = new Array(windowSize);
  }

  get perfTier(): Tier {
    return this.perf;
  }

  isReduced(): boolean {
    return this.reduced;
  }

  /** Effective tier: reduced overrides any performance-derived tier. */
  effective(): Tier {
    return this.reduced ? "reduced" : this.perf;
  }

  setReduced(v: boolean): void {
    this.reduced = v;
  }

  /** Debug/test: force the performance tier, bypassing the heuristic. */
  pinPerf(tier: Exclude<Tier, "reduced">): void {
    this.perf = tier;
    this.window.length = 0;
    this.framesSinceChange = 0;
  }

  /**
   * Record one frame's duration (ms). Returns the new perf tier if a
   * de/escalation happened this frame, else null. De-escalate when the
   * rolling median exceeds 18 ms, escalate when it drops below 11 ms, at
   * most once per `minGap` frames.
   */
  recordFrame(dtMs: number): Tier | null {
    this.window.push(dtMs);
    if (this.window.length > this.windowSize) this.window.shift();
    if (this.window.length < this.windowSize) return null;
    this.framesSinceChange++;
    if (this.framesSinceChange < this.minGap) return null;

    const median = this.median();
    let next: Tier | null = null;
    if (median > 18) {
      if (this.perf === "ultra") next = "high";
      else if (this.perf === "high") next = "low";
    } else if (median < 11) {
      if (this.perf === "low") next = "high";
      else if (this.perf === "high") next = "ultra";
    }
    if (next !== null && next !== this.perf) {
      this.perf = next;
      this.window.length = 0;
      this.framesSinceChange = 0;
      return next;
    }
    return null;
  }

  private median(): number {
    const n = this.window.length;
    for (let i = 0; i < n; i++) this.scratch[i] = this.window[i]!;
    // In-place insertion sort over the first n scratch slots: no allocation,
    // and stable enough for median purposes at window size 120.
    for (let i = 1; i < n; i++) {
      const v = this.scratch[i]!;
      let j = i - 1;
      while (j >= 0 && this.scratch[j]! > v) {
        this.scratch[j + 1] = this.scratch[j]!;
        j--;
      }
      this.scratch[j + 1] = v;
    }
    const mid = Math.floor(n / 2);
    return n % 2 === 0
      ? (this.scratch[mid - 1]! + this.scratch[mid]!) / 2
      : this.scratch[mid]!;
  }
}

/** Read the user's prefers-reduced-motion setting (browser only). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Probe device capabilities (browser only). */
export function probeCapabilities(): Capabilities {
  let webgl2 = false;
  let maxTextureSize = 0;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (gl !== null) {
      webgl2 = true;
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) ?? 0;
    }
  } catch {
    webgl2 = false;
  }
  const cores =
    typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 4;
  return { webgl2, maxTextureSize, cores };
}

/** Passes that run for a given effective tier (reduced/low -> none). */
export function passesFor(tier: Tier): readonly string[] {
  if (tier === "reduced" || tier === "low") return TIER_FEATURES.low;
  return TIER_FEATURES[tier];
}
