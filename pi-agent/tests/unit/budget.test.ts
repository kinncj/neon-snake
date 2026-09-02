import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Total gzipped size of every asset in dist/ (html, js, css, fonts, images). */
function distGzippedBytes(): number {
  let total = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = `${dir}/${name}`;
      const st = statSync(p);
      if (st.isFile()) {
        if (/\.(html|js|css|svg|png|jpg|woff2?)$/.test(name)) {
          total += gzipSync(readFileSync(p)).length;
        }
      } else if (st.isDirectory()) {
        walk(p);
      }
    }
  };
  walk(`${ROOT}/dist`);
  return total;
}

describe("bundle size budget", () => {
  // Budget: 500 KB gzipped. This is deliberately larger than the pre-engine
  // 250 KB gate because the FX/game layer is now **Phaser 4** (~350 KB gz) and
  // the audio engine is **Tone.js** (~60 KB gz) — both chosen explicitly for
  // robustness (Phaser for cross-driver WebGL context-loss recovery; Tone for
  // a rock-solid Web Audio sequencer/effects). See ADR 0007. The 2D fallback
  // path itself is still ~25 KB.
  it("total gzipped dist is <= 500KB", () => {
    // NODE_ENV=production: vitest sets NODE_ENV=test for its children and
    // Vite folds import.meta.env.DEV from the parent env — an inherited
    // test env would leak the dev-only stats.js chunk into dist.
    execSync("npx vite build", { stdio: "pipe", cwd: ROOT, env: { ...process.env, NODE_ENV: "production" } });
    const bytes = distGzippedBytes();
    console.log(`dist gzipped: ${(bytes / 1024).toFixed(1)} KB (budget 500 KB)`);
    expect(bytes).toBeLessThanOrEqual(500 * 1024);
  }, 120000);

  it("dev-only stats.js never ships in the production bundle", () => {
    // The stats.js HUD is behind a DEV-folded guard in main.ts. If any
    // toolchain state ever folds import.meta.env.DEV to true, the chunk
    // would leak into dist and mount extra canvases in the e2e matrix. Catch
    // it here, at the bundle level, where it is unambiguous.
    const assets = readdirSync(`${ROOT}/dist/assets`);
    const stray = assets.filter((a) => a.includes("stats"));
    expect(stray, `stray stats chunks: ${stray.join(", ")}`).toHaveLength(0);
    for (const a of assets) {
      if (!a.startsWith("index-") || !a.endsWith(".js")) continue;
      const body = readFileSync(`${ROOT}/dist/assets/${a}`, "utf8");
      expect(body.includes("stats.min"), `stats import in ${a}`).toBe(false);
    }
  });
});
