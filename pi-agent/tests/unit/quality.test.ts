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
    expect(pickInitialTier({ webgl2: false, maxTextureSize: 0, cores: 16 })).toBe("low");
  });
  it("WebGL2 with headroom -> ultra", () => {
    expect(pickInitialTier({ webgl2: true, maxTextureSize: 8192, cores: 8 })).toBe("ultra");
  });
  it("WebGL2 without headroom -> high", () => {
    expect(pickInitialTier({ webgl2: true, maxTextureSize: 2048, cores: 4 })).toBe("high");
  });
});

describe("TierGovernor hysteresis", () => {
  it("de-escalates ultra -> high -> low on a slow median, once per gap", () => {
    const g = new TierGovernor("ultra", false);
    const c1 = feed(g, 20, 300);
    expect(c1).toEqual(["high"]);
    const c2 = feed(g, 20, 300);
    expect(c2).toEqual(["low"]);
    // at low, more slow frames change nothing
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
    // 150 slow frames is less than the 120-window + 180-gap first eligible frame
    expect(feed(g, 20, 150)).toEqual([]);
    expect(g.perfTier).toBe("ultra");
  });

  it("a mid-range median (11..18ms) changes nothing", () => {
    const g = new TierGovernor("high", false);
    expect(feed(g, 14, 400)).toEqual([]);
    expect(g.perfTier).toBe("high");
  });

  it("reduced overrides a pinned ultra and is reported as effective", () => {
    const g = new TierGovernor("ultra", true);
    expect(g.perfTier).toBe("ultra");
    expect(g.effective()).toBe("reduced");
    g.setReduced(false);
    expect(g.effective()).toBe("ultra");
  });
});

describe("passesFor", () => {
  it("reduced and low run no post passes", () => {
    expect(passesFor("reduced")).toEqual([]);
    expect(passesFor("low")).toEqual([]);
  });
  it("high adds bloom/scanline/vignette/particles, no displacement", () => {
    const p = passesFor("high");
    for (const d of DISPLACEMENT_PASSES) expect(p).not.toContain(d);
    expect(p).toContain("bloom");
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
