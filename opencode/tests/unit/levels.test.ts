import { describe, expect, it } from "vitest";
import {
  COMBO_WINDOW_TICKS,
  foodKindForLevel,
  foodValueForKind,
  isMaxLevel,
  LEVEL_SCORES,
  LEVEL_TICK_MS,
  levelForScore,
  MAX_COMBO,
  MAX_LEVEL,
  tickMsForLevel
} from "../../app/domain/levels";

describe("levels.ts tables", () => {
  it("score thresholds are strictly increasing and start at 0", () => {
    expect(LEVEL_SCORES[0]).toBe(0);
    for (let i = 1; i < LEVEL_SCORES.length; i++)
      expect(LEVEL_SCORES[i]!).toBeGreaterThan(LEVEL_SCORES[i - 1]!);
  });

  it("tick intervals are strictly decreasing, integer, and bounded", () => {
    for (let i = 1; i < LEVEL_TICK_MS.length; i++)
      expect(LEVEL_TICK_MS[i]!).toBeLessThan(LEVEL_TICK_MS[i - 1]!);
    for (const ms of LEVEL_TICK_MS) {
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(50);
      expect(ms).toBeLessThanOrEqual(200);
    }
  });

  it("levelForScore maps across every threshold and clamps", () => {
    expect(levelForScore(0)).toBe(1);
    for (let i = 1; i < LEVEL_SCORES.length; i++) {
      expect(levelForScore(LEVEL_SCORES[i]! - 1)).toBe(i);
      expect(levelForScore(LEVEL_SCORES[i]!)).toBe(i + 1);
    }
    expect(levelForScore(999999)).toBe(MAX_LEVEL);
  });

  it("tickMsForLevel is monotonic and clamped", () => {
    expect(tickMsForLevel(1)).toBe(120);
    for (let l = 2; l <= MAX_LEVEL; l++)
      expect(tickMsForLevel(l)).toBeLessThan(tickMsForLevel(l - 1));
    expect(tickMsForLevel(99)).toBe(tickMsForLevel(MAX_LEVEL));
    expect(tickMsForLevel(0)).toBe(tickMsForLevel(1));
  });

  it("fruit kinds escalate with level: apple -> orange -> golden", () => {
    expect(foodKindForLevel(1)).toBe("apple");
    expect(foodKindForLevel(2)).toBe("apple");
    expect(foodKindForLevel(3)).toBe("orange");
    expect(foodKindForLevel(4)).toBe("orange");
    expect(foodKindForLevel(5)).toBe("golden");
    expect(foodKindForLevel(99)).toBe("golden");
  });

  it("fruit values: golden > orange > apple", () => {
    expect(foodValueForKind("apple")).toBe(10);
    expect(foodValueForKind("orange")).toBe(20);
    expect(foodValueForKind("golden")).toBe(40);
  });

  it("isMaxLevel", () => {
    expect(isMaxLevel(4)).toBe(false);
    expect(isMaxLevel(MAX_LEVEL)).toBe(true);
    expect(isMaxLevel(99)).toBe(true);
  });

  it("combo window and cap are sane", () => {
    expect(COMBO_WINDOW_TICKS).toBeGreaterThanOrEqual(3);
    expect(MAX_COMBO).toBeGreaterThanOrEqual(2);
  });
});
