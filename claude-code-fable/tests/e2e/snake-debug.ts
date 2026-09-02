import type { Page } from "@playwright/test";

/** Shape of the `window.__snake` debug surface exposed by app/main.ts. */
export interface SnakeDebug {
  hash(): string;
  state(): {
    tick: number;
    dir: number;
    phase: string;
    score: number;
    bodyLen: number;
    head: [number, number];
    food: [number, number];
    level: number;
  };
  fit(): { scale: number; backingW: number; backingH: number; dx: number; dy: number; w: number; h: number };
  sample(x: number, y: number): number[];
  fbSample(x: number, y: number): number[];
  glSample(x: number, y: number): number[];
  cellPixel(x: number, y: number): [number, number];
  freeze(): void;
  unfreeze(): void;
  forceDeath(cause?: "wall" | "self"): void;
  foodAhead(): void;
  tier(): string;
  autoTier(): string;
  setTier(t: string | null): void;
  caps(): { webgl2: boolean; maxTextureSize: number; hardwareConcurrency: number };
  fx(): { present: boolean; loading: boolean; failed: boolean; alive: boolean; frames: number; drawCount: number; bloom: number };
  loseContext(): void;
  audio(): { enabled: boolean; contextCreated: boolean; contextState: string; muted: boolean; lastSfx: string; voiceSum: number };
  setDpad(v: boolean): void;
  dpadVisible(): boolean;
  replay(logText: string, ticks: number, seed?: string): string;
  frameTimes(): number[];
  frameWork(): number[];
  highscore(): number;
  locale(): string;
  setLocale(l: string): void;
  frameCount(): number;
  tti(): number;
  combo(): number;
  palette(): Record<string, string>;
  build: string;
}

declare global {
  interface Window {
    __snake: SnakeDebug;
  }
}

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof window.__snake !== "undefined" && window.__snake.state().tick >= 0);
}

export async function snakeState(page: Page) {
  return page.evaluate(() => window.__snake.state());
}

export async function fit(page: Page) {
  return page.evaluate(() => window.__snake.fit());
}

/** RGBA at a backing-store pixel of the display canvas. */
export async function sample(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(([px, py]) => window.__snake.sample(px!, py!), [Math.floor(x), Math.floor(y)]);
}

/** Pins a tier and waits for the engine layer (if the tier needs one) to draw. */
export async function useTier(page: Page, tier: string): Promise<boolean> {
  await page.evaluate((t) => window.__snake.setTier(t), tier);
  if (tier === "low" || tier === "reduced") return true;
  try {
    await page.waitForFunction(() => {
      const f = window.__snake.fx();
      return f.failed || (f.present && f.alive && f.frames > 2);
    }, null, { timeout: 15_000 });
  } catch {
    return false;
  }
  const f = await page.evaluate(() => window.__snake.fx());
  return f.present && f.alive;
}

/** Relative luminance 0..255 of an RGBA sample. */
export function luma(c: number[]): number {
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function hexToRgb(h: string): number[] {
  const v = parseInt(h.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function near(a: number[], b: number[], tol = 24): boolean {
  return Math.abs(a[0]! - b[0]!) <= tol && Math.abs(a[1]! - b[1]!) <= tol && Math.abs(a[2]! - b[2]!) <= tol;
}
