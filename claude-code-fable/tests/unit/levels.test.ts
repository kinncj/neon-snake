import { describe, it, expect } from "vitest";
import {
  LEVEL_SCORES, LEVEL_TICK_MS, MAX_LEVEL, COMBO_WINDOW_TICKS, MAX_COMBO,
  levelForScore, tickMsForLevel, foodForLevel, foodValueForLevel, nextCombo, nextThreshold
} from "../../app/domain/levels";

describe("levels", () => {
  it("has the spec thresholds and tick intervals", () => {
    expect(LEVEL_SCORES).toEqual([0, 150, 400, 800, 1500]);
    expect(LEVEL_TICK_MS).toEqual([120, 105, 92, 82, 74]);
    expect(MAX_LEVEL).toBe(5);
  });
  it("derives the level from the score", () => {
    expect(levelForScore(0)).toBe(1);
    expect(levelForScore(149)).toBe(1);
    expect(levelForScore(150)).toBe(2);
    expect(levelForScore(400)).toBe(3);
    expect(levelForScore(799)).toBe(3);
    expect(levelForScore(800)).toBe(4);
    expect(levelForScore(1500)).toBe(5);
    expect(levelForScore(99_999)).toBe(5);
  });
  it("tick interval speeds up per level and clamps", () => {
    expect(tickMsForLevel(1)).toBe(120);
    expect(tickMsForLevel(5)).toBe(74);
    expect(tickMsForLevel(0)).toBe(120);
    expect(tickMsForLevel(9)).toBe(74);
    for (let l = 2; l <= 5; l++) expect(tickMsForLevel(l)).toBeLessThan(tickMsForLevel(l - 1));
  });
  it("food by level: apple, apple, orange, orange, golden", () => {
    expect([1, 2, 3, 4, 5].map(foodForLevel)).toEqual(["apple", "apple", "orange", "orange", "golden"]);
    expect([1, 3, 5].map(foodValueForLevel)).toEqual([10, 20, 40]);
  });
  it("combo climbs inside the window, caps at 4, resets outside", () => {
    expect(nextCombo(1, -1)).toBe(1);
    expect(nextCombo(1, COMBO_WINDOW_TICKS)).toBe(2);
    expect(nextCombo(2, 1)).toBe(3);
    expect(nextCombo(3, 2)).toBe(4);
    expect(nextCombo(4, 2)).toBe(MAX_COMBO);
    expect(nextCombo(4, COMBO_WINDOW_TICKS + 1)).toBe(1);
  });
  it("reports the next threshold, null at max", () => {
    expect(nextThreshold(1)).toBe(150);
    expect(nextThreshold(4)).toBe(1500);
    expect(nextThreshold(5)).toBeNull();
  });
});
