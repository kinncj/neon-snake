import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the production build works from any sub-path
  // (e.g. the GitHub Pages deploy at /neon-snake/pi-agent/).
  base: "./",
  build: {
    target: "es2022"
  },
  // Build stamp baked into the bundle: lets a human (and the runtime banner)
  // prove which build a page is actually running — the #1 suspect whenever
  // "my machine shows black" and CI is green.
  define: {
    __SNAKE_BUILD__: JSON.stringify(process.env.SNAKE_BUILD ?? "dev")
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/perf/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["app/**"]
    }
  }
});
