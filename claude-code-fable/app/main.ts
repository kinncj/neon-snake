import "./style.css";
import { init, step } from "./domain/step";
import { hash } from "./domain/hash";
import { createSink, resetSink } from "./domain/types";
import { createLoop } from "./runtime/loop";
import { createFramebuffer, BASE_PALETTE } from "./adapters/render/framebuffer";

const TICK_MS = 120;

const display = document.getElementById("display") as HTMLCanvasElement;
const state = init("snake-0001");
const sink = createSink();
const fb = createFramebuffer();

function resize(): void {
  fb.resize(display, window.devicePixelRatio || 1);
}
window.addEventListener("resize", resize);
resize();

const loop = createLoop({
  tickMs: () => TICK_MS,
  onTick() {
    resetSink(sink);
    step(state, sink);
  },
  onFrame(alpha) {
    fb.draw(state, alpha, BASE_PALETTE);
    fb.composite(display, "#000000");
  }
});
loop.start();

/** Debug surface for the e2e suite; read-only unless a method says otherwise. */
const debug = {
  hash: () => hash(state),
  state: () => ({
    tick: state.tick,
    dir: state.dir,
    phase: state.phase,
    score: state.score,
    bodyLen: state.bodyLen,
    head: [state.body[0]! % 32, Math.floor(state.body[0]! / 32)],
    food: [state.foodX, state.foodY],
    level: state.level
  }),
  fit: () => ({ ...fb.fit }),
  /** Stops the loop (simulation and rendering) so a test can read a stable frame. */
  freeze: () => loop.stop(),
  unfreeze: () => loop.start(),
  /** RGBA of the display canvas at a backing-store pixel. */
  sample(x: number, y: number): number[] {
    const ctx = display.getContext("2d");
    if (!ctx) return [0, 0, 0, 0];
    const d = ctx.getImageData(x, y, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]!];
  },
  build: typeof __SNAKE_BUILD__ === "string" ? __SNAKE_BUILD__ : "dev"
};
(window as unknown as { __snake: typeof debug }).__snake = debug;
