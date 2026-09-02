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
  freeze(): void;
  unfreeze(): void;
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
