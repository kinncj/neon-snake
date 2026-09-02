import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { defineConfig, firefox, webkit } from "@playwright/test";
import type { PlaywrightTestConfig } from "@playwright/test";

/**
 * Browser matrix: Chromium + Firefox + WebKit, minus any engine whose binary
 * cannot load on this host. On Linux each engine binary is probed with `ldd`;
 * missing shared libraries drop the engine from the matrix instead of failing
 * the whole run (the WPE WebKit build needs system libs that are not always
 * installable without root).
 */
function unusable(exe: string): boolean {
  if (!existsSync(exe)) return true;
  if (process.platform !== "linux") return false;
  try {
    const out = String(execSync(`ldd "${exe}" 2>/dev/null`, { encoding: "utf8" }));
    return out.includes("not found");
  } catch {
    return false;
  }
}

function webkitUsable(): boolean {
  const p = webkit.executablePath();
  const i = p.indexOf("webkit-");
  if (i < 0) return false;
  const base = p.slice(0, i);
  return (
    !unusable(base + "minibrowser-wpe/bin/MiniBrowser") &&
    !unusable(base + "minibrowser-gtk/bin/MiniBrowser")
  );
}

const projects: PlaywrightTestConfig["projects"] = [
  { name: "chromium", use: { browserName: "chromium" } }
];
if (!unusable(firefox.executablePath())) {
  projects.push({ name: "firefox", use: { browserName: "firefox" } });
}
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
    reuseExistingServer: false,
    timeout: 60_000
  }
});
