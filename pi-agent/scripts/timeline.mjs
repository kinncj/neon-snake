import { readFileSync } from "node:fs";

const log = process.argv[2];
const lines = readFileSync(log, "utf8").split("\n").filter((l) => l.length > 0);
const starts = new Map(); // step -> first START
const ends = new Map();   // step -> last END (a re-log after rework extends the step)
const order = [];
for (const line of lines) {
  const [ts, kind, step] = line.split("\t");
  if (kind === "START") {
    if (!starts.has(step)) { starts.set(step, ts); order.push(step); }
  } else if (kind === "END") {
    ends.set(step, ts);
    if (!starts.has(step)) order.push(step);
  }
}

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m > 0 ? `${m}m ${r.toFixed(1)}s` : `${r.toFixed(1)}s`;
}

const out = ["# Build log", "", "| step | start | end | duration |", "|---|---|---|---|"];
let total = 0;
for (const step of order) {
  const st = starts.get(step);
  const en = ends.get(step);
  if (st === undefined || en === undefined) {
    out.push(`| ${step} | ${st ?? "—"} | ${en ?? "—"} | INCOMPLETE |`);
  } else {
    const dur = (Date.parse(en) - Date.parse(st)) / 1000;
    total += dur;
    out.push(`| ${step} | ${st} | ${en} | ${fmt(dur)} |`);
  }
}
out.push("", `**Total: ${fmt(total)}**`);
console.log(out.join("\n"));
