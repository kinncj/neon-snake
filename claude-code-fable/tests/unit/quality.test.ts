import { describe, it, expect } from "vitest";
import {
  createGovernor, tierForCapabilities, GOVERNOR_WINDOW, GOVERNOR_MIN_GAP, DEESCALATE_MS, ESCALATE_MS
} from "../../app/runtime/quality";

describe("tierForCapabilities", () => {
  it("no WebGL2 means low", () => {
    expect(tierForCapabilities({ webgl2: false, maxTextureSize: 16384, hardwareConcurrency: 16 })).toBe("low");
  });
  it("big textures and many cores mean ultra, mid-range means high", () => {
    expect(tierForCapabilities({ webgl2: true, maxTextureSize: 16384, hardwareConcurrency: 8 })).toBe("ultra");
    expect(tierForCapabilities({ webgl2: true, maxTextureSize: 4096, hardwareConcurrency: 4 })).toBe("high");
    expect(tierForCapabilities({ webgl2: true, maxTextureSize: 4096, hardwareConcurrency: 2 })).toBe("low");
  });
});

function feed(g: ReturnType<typeof createGovernor>, ms: number, n: number): string {
  let t = g.tier();
  for (let i = 0; i < n; i++) t = g.sample(ms);
  return t;
}

describe("governor", () => {
  it("de-escalates when the rolling median exceeds 18 ms", () => {
    const g = createGovernor("ultra");
    expect(g.tier()).toBe("ultra");
    feed(g, DEESCALATE_MS + 4, GOVERNOR_MIN_GAP - 1);
    expect(g.tier()).toBe("ultra"); // not before the minimum gap
    g.sample(DEESCALATE_MS + 4);
    expect(g.tier()).toBe("high");
  });
  it("escalates when the median drops below 11 ms", () => {
    const g = createGovernor("low");
    feed(g, ESCALATE_MS - 3, GOVERNOR_MIN_GAP);
    expect(g.tier()).toBe("high");
    feed(g, ESCALATE_MS - 3, GOVERNOR_MIN_GAP);
    expect(g.tier()).toBe("ultra");
    feed(g, ESCALATE_MS - 3, GOVERNOR_MIN_GAP * 2);
    expect(g.tier()).toBe("ultra"); // capped
  });
  it("waits 180 frames between changes and uses a median, not a mean", () => {
    const g = createGovernor("ultra");
    // A window of fast frames with a few huge spikes: the median stays low.
    for (let i = 0; i < GOVERNOR_MIN_GAP + GOVERNOR_WINDOW; i++) g.sample(i % 10 === 0 ? 200 : 8);
    expect(g.tier()).toBe("ultra");
    // Now sustained slowness.
    feed(g, 30, GOVERNOR_WINDOW);
    expect(g.tier()).toBe("high");
    // The change fired once the median crossed, partway through that window.
    const since = g.frames();
    expect(since).toBeLessThan(GOVERNOR_WINDOW);
    feed(g, 30, GOVERNOR_MIN_GAP - since - 1);
    expect(g.tier()).toBe("high");
    g.sample(30);
    expect(g.tier()).toBe("low");
  });
  it("median needs a full window", () => {
    const g = createGovernor("high");
    expect(g.median()).toBe(0);
    feed(g, 12, GOVERNOR_WINDOW);
    expect(g.median()).toBe(12);
  });
  it("forced reduced overrides the performance tier and can be lifted", () => {
    const g = createGovernor("ultra");
    g.setForcedReduced(true);
    expect(g.tier()).toBe("reduced");
    feed(g, 5, GOVERNOR_MIN_GAP);
    expect(g.tier()).toBe("reduced");
    expect(g.autoTier()).toBe("ultra");
    g.setForcedReduced(false);
    expect(g.tier()).toBe("ultra");
  });
  it("a pin holds a tier and clears cleanly", () => {
    const g = createGovernor("ultra");
    g.pin("low");
    feed(g, 5, GOVERNOR_MIN_GAP);
    expect(g.tier()).toBe("low");
    g.pin(null);
    expect(g.tier()).toBe("low"); // pin set the ladder index too
  });
  it("respects a max tier", () => {
    const g = createGovernor("low", { max: "high" });
    feed(g, 5, GOVERNOR_MIN_GAP * 3);
    expect(g.tier()).toBe("high");
  });
});
