import { type EffectSink, type Intent, type State, INTENT_PAUSE, INTENT_RESTART, createSink } from "./types";
import { init, step, apply } from "./step";
import { hash } from "./hash";

/** One line of an input log: apply `intent` before stepping `tick`. */
export interface LogEntry {
  tick: number;
  intent: Intent;
}

/**
 * Parses the `tick,kind[,dir]` log format. Blank lines and `#` comments
 * are ignored. Entries must be in non-decreasing tick order.
 */
export function parseLog(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const parts = line.split(",");
    const tick = Number(parts[0]);
    const kind = parts[1];
    let intent: Intent;
    if (kind === "turn") intent = Number(parts[2]) & 3;
    else if (kind === "pause") intent = INTENT_PAUSE;
    else if (kind === "restart") intent = INTENT_RESTART;
    else throw new Error("bad log line: " + line);
    out.push({ tick, intent });
  }
  return out;
}

/**
 * Drives a fresh engine for `ticks` ticks, applying logged intents at their
 * ticks, and returns the final hash. `onTick` lets a caller observe each
 * state (renderers in tests, for example) without affecting the outcome.
 */
export function replay(
  seed: string,
  log: readonly LogEntry[],
  ticks: number,
  onTick?: (s: State, sink: EffectSink) => void
): string {
  const s = init(seed);
  const sink = createSink();
  let li = 0;
  for (let t = 0; t < ticks; t++) {
    while (li < log.length && log[li]!.tick <= t) {
      apply(s, log[li]!.intent);
      li++;
    }
    sink.head = 0;
    sink.len = 0;
    sink.dropped = 0;
    step(s, sink);
    if (onTick) onTick(s, sink);
  }
  return hash(s);
}
