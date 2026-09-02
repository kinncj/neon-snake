/**
 * Per-level neon themes.
 *
 * The domain has no idea these exist: a level is an integer, and the
 * *presentation* maps that integer to a colour story. This keeps the engine
 * pure and replayable while letting the game visibly "shift" as you climb.
 *
 * The ThemeMixer holds the *current* (possibly mid-transition) colours and
 * lerps them toward the active level's target. It is deliberately allocation
 * free at steady state: the colour arrays are preallocated and mutated in
 * place, and the CSS string is only rebuilt when a channel actually changes.
 *
 * Level 1 is the base 2D scene established in step 10 (bg #12121c, grid
 * #24283b, body #00e5ff, head #c0caf5); levels 2-5 shift the whole scene
 * toward "golden hour". The per-level *accent* matches the spec's palette
 * table (#00e5ff / #ff2e88 / #9d6bff / #ff7849 / #ffd166).
 */

export interface ThemeColours {
  /** page / letterbox background */
  bg: readonly number[]; // [r,g,b] 0-255
  /** field grid lines */
  grid: readonly number[];
  /** snake body */
  snake: readonly number[];
  /** snake head */
  head: readonly number[];
  /** emissive trail / accent (bloom tint, HUD accent) */
  accent: readonly number[];
  /** food halo tint (FX only; the 2D food uses per-kind colours) */
  food: readonly number[];
  hi: readonly number[];
  dim: readonly number[];
  black: readonly number[];
}

export interface LevelTheme {
  readonly name: string;
  readonly colors: ThemeColours;
}

const HI: readonly number[] = [0xff, 0xff, 0xff];
const BLACK: readonly number[] = [0x00, 0x00, 0x00];

/**
 * Five neon themes, one per level. Each shifts the whole scene as the player
 * climbs, so a level-up is a visible event, not just a number change.
 */
export const LEVEL_THEMES: readonly LevelTheme[] = [
  { // L1 — Midnight Cyan (base 2D scene, step 10)
    name: "midnight-cyan",
    colors: {
      bg: [0x12, 0x12, 0x1c],
      grid: [0x24, 0x28, 0x3b],
      snake: [0x00, 0xe5, 0xff],
      head: [0xc0, 0xca, 0xf5],
      accent: [0x00, 0xe5, 0xff],
      food: [0xff, 0x5f, 0x56],
      hi: HI,
      dim: [0x41, 0x48, 0x68],
      black: BLACK
    }
  },
  { // L2 — Neon Magenta
    name: "neon-magenta",
    colors: {
      bg: [0x0a, 0x05, 0x14],
      grid: [0x18, 0x0b, 0x33],
      snake: [0xff, 0x2e, 0x88],
      head: [0xff, 0x7a, 0xc1],
      accent: [0xff, 0x2e, 0x88],
      food: [0xff, 0x2e, 0x88],
      hi: HI,
      dim: [0x33, 0x2a, 0x52],
      black: BLACK
    }
  },
  { // L3 — Electric Violet
    name: "electric-violet",
    colors: {
      bg: [0x0b, 0x06, 0x1c],
      grid: [0x1c, 0x0e, 0x3d],
      snake: [0x7c, 0x4d, 0xff],
      head: [0xb1, 0x8c, 0xff],
      accent: [0x9d, 0x6b, 0xff],
      food: [0xff, 0x2e, 0x88],
      hi: HI,
      dim: [0x30, 0x2a, 0x52],
      black: BLACK
    }
  },
  { // L4 — Tokyo Sunset
    name: "tokyo-sunset",
    colors: {
      bg: [0x12, 0x06, 0x10],
      grid: [0x2b, 0x0e, 0x24],
      snake: [0xff, 0x52, 0x52],
      head: [0xff, 0x8a, 0x80],
      accent: [0xff, 0x78, 0x49],
      food: [0xff, 0x2e, 0x88],
      hi: HI,
      dim: [0x3a, 0x2a, 0x4a],
      black: BLACK
    }
  },
  { // L5 — Golden Hour
    name: "golden-hour",
    colors: {
      bg: [0x14, 0x10, 0x05],
      grid: [0x33, 0x28, 0x0e],
      snake: [0xff, 0xd1, 0x66],
      head: [0xff, 0xe9, 0xa8],
      accent: [0xff, 0xd1, 0x66],
      food: [0xff, 0x2e, 0x88],
      hi: HI,
      dim: [0x4a, 0x3a, 0x2a],
      black: BLACK
    }
  }
];

export function themeForLevel(level: number): LevelTheme {
  const idx = Math.min(Math.max(level - 1, 0), LEVEL_THEMES.length - 1);
  return LEVEL_THEMES[idx]!;
}

/**
 * Mutable, preallocated colour set the mixer writes into. Callers read the
 * channels; nothing here allocates after construction.
 */
export class ThemeMixer {
  bg: [number, number, number];
  grid: [number, number, number];
  snake: [number, number, number];
  head: [number, number, number];
  accent: [number, number, number];
  food: [number, number, number];
  hi: [number, number, number];
  dim: [number, number, number];
  black: [number, number, number];

  /** css string cache for the accent (rebuilt only on change). */
  accentCss = "";
  /** cached fillStyle strings; rebuilt only when a channel actually moves. */
  bgCss = "";
  gridCss = "";
  foodCss = "";
  hiCss = "";
  snakeCss = "";
  headCss = "";
  blackCss = "";
  /** the level we're currently targeting. */
  private targetLevel = 1;
  /** remaining transition progress 0..1 (1 = settled). */
  private t = 1;

  constructor(level: number) {
    const c = themeForLevel(level).colors;
    this.bg = [c.bg[0]!, c.bg[1]!, c.bg[2]!];
    this.grid = [c.grid[0]!, c.grid[1]!, c.grid[2]!];
    this.snake = [c.snake[0]!, c.snake[1]!, c.snake[2]!];
    this.head = [c.head[0]!, c.head[1]!, c.head[2]!];
    this.accent = [c.accent[0]!, c.accent[1]!, c.accent[2]!];
    this.food = [c.food[0]!, c.food[1]!, c.food[2]!];
    this.hi = [c.hi[0]!, c.hi[1]!, c.hi[2]!];
    this.dim = [c.dim[0]!, c.dim[1]!, c.dim[2]!];
    this.black = [c.black[0]!, c.black[1]!, c.black[2]!];
    this.targetLevel = level;
    this.refreshCss();
  }

  /** Rebuild the css caches; only the strings whose colour moved change. */
  private refreshCss(): void {
    const a = this.css;
    if (this.bgCss !== a(this.bg)) this.bgCss = a(this.bg);
    if (this.gridCss !== a(this.grid)) this.gridCss = a(this.grid);
    if (this.foodCss !== a(this.food)) this.foodCss = a(this.food);
    if (this.hiCss !== a(this.hi)) this.hiCss = a(this.hi);
    if (this.snakeCss !== a(this.snake)) this.snakeCss = a(this.snake);
    if (this.headCss !== a(this.head)) this.headCss = a(this.head);
    if (this.blackCss !== a(this.black)) this.blackCss = a(this.black);
    if (this.accentCss !== a(this.accent)) this.accentCss = a(this.accent);
  }

  /**
   * Point the mixer at a level. Restarts the transition only when the
   * target level actually changed; staying on the same level is a no-op so
   * the per-frame call site can keep advancing an in-flight transition.
   */
  setLevel(level: number): boolean {
    const clamped = Math.min(Math.max(level, 1), LEVEL_THEMES.length);
    if (clamped === this.targetLevel) return false;
    this.targetLevel = clamped;
    this.t = 0;
    return true;
  }

  /**
   * Advance the transition by dtMs. Lerp with ease-out so the shift lands
   * fast then settles. Returns true while the transition is live (callers
   * use this to know the colours moved this frame).
   */
  update(dtMs: number): boolean {
    if (this.t >= 1) return false;
    const DUR = 600; // full transition time
    this.t = Math.min(1, this.t + dtMs / DUR);
    const k = 1 - (1 - this.t) * (1 - this.t); // easeOutQuad
    const target = themeForLevel(this.targetLevel).colors;
    this.lerp(this.bg, target.bg, k);
    this.lerp(this.grid, target.grid, k);
    this.lerp(this.snake, target.snake, k);
    this.lerp(this.head, target.head, k);
    this.lerp(this.accent, target.accent, k);
    this.lerp(this.food, target.food, k);
    this.lerp(this.dim, target.dim, k);
    this.refreshCss();
    return this.t < 1;
  }

  private lerp(cur: [number, number, number], target: readonly number[], k: number): void {
    cur[0] = Math.round(cur[0] + (target[0]! - cur[0]) * k);
    cur[1] = Math.round(cur[1] + (target[1]! - cur[1]) * k);
    cur[2] = Math.round(cur[2] + (target[2]! - cur[2]) * k);
  }

  private css(c: readonly number[]): string {
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
}
