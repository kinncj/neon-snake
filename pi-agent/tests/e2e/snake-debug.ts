// Single shared declaration of the e2e debug surface exposed on window by
// app/main.ts. Both e2e specs import this module for the type; the `declare
// global` here is the only Window augmentation in the project.
export interface SnakeDebugState {
  tick: number;
  phase: "playing" | "paused" | "gameover";
  bodyLen: number;
  score: number;
  pendingLen: number;
  dir: number;
  body: { x: number; y: number }[];
  food: { x: number; y: number; kind: "apple" | "orange" | "golden" };
  level: number;
  combo: number;
  best: number;
}

export interface SnakeDebugTier {
  effective(): string;
  perf(): string;
  passes(): string[];
  pinPerf(t: string): void;
  setReduced(v: boolean): void;
}

export interface SnakeDebug {
  state: SnakeDebugState;
  canvas: HTMLCanvasElement;
  tier: SnakeDebugTier;
  composite(): {
    deviceW: number;
    deviceH: number;
    scale: number;
    offX: number;
    offY: number;
    drawW: number;
    drawH: number;
  };
  fingerprint(): { hash: string; tick: number; bodyLen: number; score: number };
  freeze(): void;
  unfreeze(): void;
  sample(x: number, y: number): number[];
  luma(): number;
  fx: {
    ready(): boolean;
    selfTest(): "ok" | "black" | "unreadable";
    disable(reason?: string): void;
    forceTier(t: "low" | "high" | "ultra"): void;
    info(): {
      tier: string;
      bloom: number;
      particles: number;
      shockActive: boolean;
      deathActive: boolean;
      shakeActive: boolean;
      drawCalls: number;
      texMB: number;
      fbo: [number, number];
      gl: { version: string; renderer: string };
      fieldRect: number[];
      theme: { level: number; accent: string; bg: number[] };
    };
    teleportFoodAhead(): void;
    forceDeath(): void;
  };
  replayLog(text: string, seed: string): string;
  deathCause(): "none" | "wall" | "self";
  perf(): { p95: number; p50: number; max: number; n: number };
  setLocale(l: "en" | "ja" | "es"): void;
  bumpScore(n: number): void;
  ui: { mode(): string; start(): void };
  audio: {
    info(): {
      unlocked: boolean;
      running: boolean;
      state: string;
      master: number;
      voices: string[];
      duckCap: number;
      ducked: boolean;
      song: number;
      sfx: Record<string, number>;
    };
    unlock(): void;
    duck(v: boolean): void;
    blip(voice: "pulse" | "triangle" | "noise" | "lead", midi: number): void;
  };
}

declare global {
  interface Window {
    __snake?: SnakeDebug;
  }
}

/**
 * Shared e2e setup that actually reaches the PLAYING state: the game boots
 * behind the title screen (paused), so gameplay tests start it first via the
 * debug surface (equivalent to pressing any key).
 */
export async function play(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__snake !== undefined);
  await page.evaluate(() => window.__snake!.ui.start());
  await page.waitForFunction(() => window.__snake!.state.phase === "playing");
}
