import { describe, expect, it } from "vitest";
import {
  DISPLACEMENT_PASSES,
  passesFor,
  pickInitialTier,
  TierGovernor,
  type Tier
} from "../../app/runtime/quality";

function feed(g: TierGovernor, ms: number, n: number): Tier[] {
  const changed: Tier[] = [];
  for (let i = 0; i < n; i++) {
    const c = g.recordFrame(ms);
    if (c !== null) changed.push(c);
  }
  return changed;
}

describe("pickInitialTier", () => {
  it("no WebGL2 -> low", () => {
    expect(pickInitialTier({ webgl2: false, maxTextureSize: 0, cores: 16 })).toBe(
      "low"
    );
  });

  it("WebGL2 with headroom (big textures, 8+ cores) -> ultra", () => {
    expect(pickInitialTier({ webgl2: true, maxTextureSize: 8192, cores: 8 })).toBe(
      "ultra"
    );
  });

  it("WebGL2 without headroom -> high", () => {
    expect(pickInitialTier({ webgl2: true, maxTextureSize: 2048, cores: 4 })).toBe(
      "high"
    );
    expect(pickInitialTier({ webgl2: true, maxTextureSize: 8192, cores: 4 })).toBe(
      "high"
    );
    expect(pickInitialTier({ webgl2: true, maxTextureSize: 2048, cores: 16 })).toBe(
      "high"
    );
  });
});

describe("TierGovernor hysteresis", () => {
  it("de-escalates ultra -> high -> low on a slow median, once per gap", () => {
    const g = new TierGovernor("ultra", false);
    expect(feed(g, 20, 300)).toEqual(["high"]);
    expect(feed(g, 20, 300)).toEqual(["low"]);
    // At low, more slow frames change nothing.
    expect(feed(g, 20, 300)).toEqual([]);
    expect(g.perfTier).toBe("low");
  });

  it("escalates low -> high -> ultra on a fast median", () => {
    const g = new TierGovernor("low", false);
    expect(feed(g, 5, 300)).toEqual(["high"]);
    expect(feed(g, 5, 300)).toEqual(["ultra"]);
    expect(feed(g, 5, 300)).toEqual([]);
    expect(g.perfTier).toBe("ultra");
  });

  it("no change within the hysteresis gap", () => {
    const g = new TierGovernor("ultra", false);
    // 150 slow frames is less than the 120-window + 180-gap first eligible
    // frame, so nothing may fire yet.
    expect(feed(g, 20, 150)).toEqual([]);
    expect(g.perfTier).toBe("ultra");
  });

  it("a mid-range median (11..18 ms) changes nothing", () => {
    const g = new TierGovernor("high", false);
    expect(feed(g, 14, 400)).toEqual([]);
    expect(g.perfTier).toBe("high");
  });

  it("de/escalation resets the window and the gap", () => {
    const g = new TierGovernor("low", false);
    expect(feed(g, 5, 300)).toEqual(["high"]);
    // After the reset, the next decision needs a full window + gap again.
    expect(feed(g, 5, 100)).toEqual([]);
    expect(g.perfTier).toBe("high");
    expect(feed(g, 5, 200)).toEqual(["ultra"]);
  });

  it("reduced overrides a pinned ultra and is reported as effective", () => {
    const g = new TierGovernor("ultra", true);
    expect(g.perfTier).toBe("ultra");
    expect(g.effective()).toBe("reduced");
    expect(g.isReduced()).toBe(true);
    g.setReduced(false);
    expect(g.effective()).toBe("ultra");
    expect(g.isReduced()).toBe(false);
  });

  it("pinPerf forces the perf tier and clears the governor state", () => {
    const g = new TierGovernor("low", false);
    g.pinPerf("ultra");
    expect(g.perfTier).toBe("ultra");
    // Fresh window: 100 slow frames alone cannot de-escalate yet.
    expect(feed(g, 20, 100)).toEqual([]);
    expect(g.perfTier).toBe("ultra");
  });
});

describe("passesFor", () => {
  it("reduced and low run no post passes", () => {
    expect(passesFor("reduced")).toEqual([]);
    expect(passesFor("low")).toEqual([]);
  });

  it("high adds the basic passes but no displacement", () => {
    const p = passesFor("high");
    for (const d of DISPLACEMENT_PASSES) expect(p).not.toContain(d);
    expect(p).toContain("bloom");
    expect(p).toContain("particles");
    expect(p).toContain("scanline");
    expect(p).toContain("vignette");
  });

  it("ultra includes every displacement pass", () => {
    const p = passesFor("ultra");
    for (const d of DISPLACEMENT_PASSES) expect(p).toContain(d);
  });

  it("reduced runs none of the displacement passes", () => {
    const p = passesFor("reduced");
    for (const d of DISPLACEMENT_PASSES) expect(p).not.toContain(d);
  });
});
