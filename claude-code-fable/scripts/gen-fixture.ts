// Records tests/fixtures/run-a.log: a steering bot plays seed `snake-0001`
// for 5000 ticks and every intent it issues is logged as `tick,kind[,dir]`.
// The bot is greedy-toward-food with a reachability check so the run lasts;
// a few pauses are sprinkled in to exercise the phase toggle.
// Usage: npx vite-node scripts/gen-fixture.ts > tests/fixtures/run-a.log
import { init, step, apply } from "../app/domain/step";
import { seedFrom, next, rangeOf } from "../app/domain/rng";
import {
  type Dir, createSink, cellX, cellY, packCell, opposite,
  GRID_W, GRID_H, CELL_COUNT, DIR_DX, DIR_DY, INTENT_PAUSE, turnIntent
} from "../app/domain/types";

const TICKS = 5000;
const s = init("snake-0001");
const sink = createSink();
let bot = seedFrom("bot");
const lines: string[] = [];
const mark = new Uint8Array(CELL_COUNT);

function free(x: number, y: number, skipTail: boolean): boolean {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return false;
  const c = packCell(x, y);
  const last = skipTail ? s.bodyLen - 1 : s.bodyLen;
  for (let i = 0; i < last; i++) if (s.body[i] === c) return false;
  return true;
}

let sawTail = false;
function reachable(x: number, y: number): number {
  mark.fill(0);
  for (let i = 0; i < s.bodyLen - 1; i++) mark[s.body[i]!] = 1;
  const tail = s.body[s.bodyLen - 1]!;
  sawTail = false;
  const stack = [packCell(x, y)];
  mark[packCell(x, y)] = 1;
  let n = 0;
  while (stack.length > 0 && n < CELL_COUNT) {
    const c = stack.pop()!;
    n++;
    if (c === tail) sawTail = true;
    const cx = cellX(c);
    const cy = cellY(c);
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIR_DX[d]!;
      const ny = cy + DIR_DY[d]!;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const nc = packCell(nx, ny);
      if (mark[nc]) continue;
      mark[nc] = 1;
      stack.push(nc);
    }
  }
  return n;
}

const pauses = new Set([777, 778, 2500, 2503, 4200, 4201]);

for (let t = 0; t < TICKS; t++) {
  if (pauses.has(t)) {
    apply(s, INTENT_PAUSE);
    lines.push(`${t},pause`);
  }
  if (s.phase === "playing") {
    const hx = cellX(s.body[0]!);
    const hy = cellY(s.body[0]!);
    let best: Dir = s.dir;
    let bestScore = -1e9;
    bot = next(bot);
    const jitter = rangeOf(bot, 100);
    for (let d = 0; d < 4; d++) {
      const dir = d as Dir;
      if (dir === opposite(s.dir)) continue;
      const nx = hx + DIR_DX[d]!;
      const ny = hy + DIR_DY[d]!;
      const eats = nx === s.foodX && ny === s.foodY;
      if (!free(nx, ny, !eats)) continue;
      const room = reachable(nx, ny);
      let score = sawTail ? 0 : room - 2000;
      const dist = Math.abs(nx - s.foodX) + Math.abs(ny - s.foodY);
      score -= dist * 3;
      if (dir === s.dir) score += 7;
      bot = next(bot);
      score += rangeOf(bot, jitter < 5 ? 20 : 3);
      if (score > bestScore) {
        bestScore = score;
        best = dir;
      }
    }
    if (best !== s.dir) {
      if (apply(s, turnIntent(best))) lines.push(`${t},turn,${best}`);
    }
  }
  sink.len = 0;
  sink.head = 0;
  step(s, sink);
  if (s.phase === "gameover") {
    process.stderr.write(`died at tick ${t}\n`);
    break;
  }
}
process.stderr.write(`intents=${lines.length} bodyLen=${s.bodyLen} score=${s.score} tick=${s.tick}\n`);
process.stdout.write(lines.join("\n") + "\n");
