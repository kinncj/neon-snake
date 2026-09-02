import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { defineConfig, firefox, webkit } from "@playwright/test";
import type { PlaywrightTestConfig } from "@playwright/test";

/**
 * Cross-browser matrix: Chromium (Blink), Firefox (Gecko), WebKit (Safari's
 * engine).
 *
 * The matrix is honest about the host: on Linux we `ldd` each engine's
 * binary and drop it from the matrix if shared libraries are missing — the
 * WPE webkit build needs system libs (WPE backend, flite TTS, …) that are
 * not installable everywhere without root, and skipping cleanly beats
 * failing the whole run. Engines that do run still give real cross-engine
 * coverage (Gecko is a different rendering engine from Blink).
 *
 * Test-level caveats (inside the specs):
 * - perf.spec.ts uses CDP (Chromium-only) and self-skips elsewhere.
 * - audio.spec.ts skips the WebKit runs (headless WebKit has no audio
 *   output pipeline; the Web Audio code path is covered by unit tests).
 */

/** True when the binary is missing or (on Linux) misses shared libraries. */
function unusable(exe: string): boolean {
  if (!existsSync(exe)) return true;
  if (process.platform !== "linux") return false; // bundles are self-contained
  try {
    const out = String(
      execSync(`ldd "${exe}" 2>/dev/null`, { encoding: "utf8" })
    );
    return out.includes("not found");
  } catch {
    return false; // can't tell — let it try and fail loudly if broken
  }
}

function firefoxUsable(): boolean {
  return !unusable(firefox.executablePath());
}

/** Parent dir of the webkit install root (…/webkit-NNNN/). */
function webkitRoot(): string | null {
  const p = webkit.executablePath();
  const i = p.indexOf("webkit-");
  return i >= 0 ? p.slice(0, i) : null;
}

function webkitUsable(): boolean {
  // Playwright launches webkit through the WPE binary; GTK is the headed
  // fallback. Either missing libs = unusable.
  const base = webkitRoot();
  if (base === null) return false;
  return (
    !unusable(base + "minibrowser-wpe/bin/MiniBrowser") &&
    !unusable(base + "minibrowser-gtk/bin/MiniBrowser")
  );
}

const projects: PlaywrightTestConfig["projects"] = [
  { name: "chromium", use: { browserName: "chromium" } }
];
if (firefoxUsable()) projects.push({ name: "firefox", use: { browserName: "firefox" } });
if (webkitUsable()) projects.push({ name: "webkit", use: { browserName: "webkit" } });

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  workers: 1,
  retries: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true
  },
  projects,
  webServer: {
    command: "npx vite preview --port 4173",
    url: "http://127.0.0.1:4173",
    // Always spin up a fresh preview of the current dist. Reusing a stale
    // server (reuseExistingServer: true) let an old build — one that
    // shipped the dev-only stats.js canvas — bleed into the matrix.
    reuseExistingServer: false,
    timeout: 60_000
  }
});
