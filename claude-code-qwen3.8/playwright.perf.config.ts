import { defineConfig, devices } from '@playwright/test'

// Perf-budget suite (step 16). Measures the steady-state frame time (p95) and
// steady-state JS-heap growth at the low tier under a 4x CPU throttle. Kept
// separate from the e2e config so `make ci`'s e2e run is unaffected; run via
// `make bench` (scripts/bench.mjs). Chromium-only: the allocation probe uses CDP
// (JSHeapUsedSize + --expose-gc), which is Chromium-specific. Serves dist/ via
// `vite preview`, so run `make build` first (bench.mjs does).
export default defineConfig({
  testDir: 'tests/perf',
  timeout: 120_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium-perf',
      use: { ...devices['Desktop Chrome'] },
      launchOptions: { args: ['--expose-gc'] },
    },
  ],
})
