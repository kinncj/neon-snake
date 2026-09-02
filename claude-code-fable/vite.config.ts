import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base: the production bundle runs from any sub-path
  // (the GitHub Pages deploy serves it under /neon-snake/claude-code-fable/).
  base: "./",
  build: {
    target: "es2022"
  },
  // Build stamp: the runtime footer shows which bundle a page is running.
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
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["app/**"]
    }
  }
});
