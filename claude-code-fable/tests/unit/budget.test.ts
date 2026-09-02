import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { gzipSync } from "node:zlib";

/**
 * Transfer budget: everything in dist/ gzipped must fit in 500 KB. The
 * production bundle is built here when missing (a clean checkout runs the
 * unit suite before `make build`), with NODE_ENV=production so the dev-only
 * stats.js panel cannot leak in.
 */
const BUDGET_BYTES = 500 * 1024;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = dir + "/" + name;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("bundle budget", () => {
  it("total gzipped dist is at most 500 KB and ships no dev-only stats panel", () => {
    if (!existsSync("dist/index.html")) {
      execSync("npx vite build", { stdio: "ignore", env: { ...process.env, NODE_ENV: "production" }, timeout: 180_000 });
    }
    const files = walk("dist");
    let total = 0;
    let js = "";
    for (const f of files) {
      const raw = readFileSync(f);
      total += gzipSync(raw).length;
      if (f.endsWith(".js")) js += readFileSync(f, "utf8");
    }
    expect(files.length).toBeGreaterThan(2);
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
    expect(js.includes("stats.js") || js.includes("Stats.js")).toBe(false);
    expect(js).not.toContain("mrdoob"); // stats.js author banner
  });
});
