// Renders docs/build-log.tsv (stamped by `make log-start` / `make log-end`)
// into a markdown table. First START and last END per step: a re-logged end
// after rework stretches the step, so the recorded cost includes the fix.
import { readFileSync } from "node:fs";

const rows = readFileSync(process.argv[2], "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0)
  .map((l) => l.split("\t"));

const order = [];
const start = new Map();
const end = new Map();
for (const [ts, kind, step] of rows) {
  if (!start.has(step) && !end.has(step)) order.push(step);
  if (kind === "START" && !start.has(step)) start.set(step, ts);
  if (kind === "END") end.set(step, ts);
}

const human = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}m ${s.toFixed(0)}s` : `${s.toFixed(1)}s`;
};

const lines = ["# Build log", "", "| step | start (UTC) | end (UTC) | duration |", "|---|---|---|---|"];
let total = 0;
for (const step of order) {
  const a = start.get(step);
  const b = end.get(step);
  if (a === undefined || b === undefined) {
    lines.push(`| ${step} | ${a ?? "—"} | ${b ?? "—"} | INCOMPLETE |`);
    continue;
  }
  const d = (Date.parse(b) - Date.parse(a)) / 1000;
  if (step !== "00-project") total += d;
  lines.push(`| ${step} | ${a} | ${b} | ${human(d)} |`);
}
lines.push("", `Sum of step durations: **${human(total)}** (00-project brackets the whole build).`);
process.stdout.write(lines.join("\n") + "\n");
