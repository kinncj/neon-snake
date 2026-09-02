import { defineConfig } from 'vitest/config'

// Unit tests run in a bare Node environment: the domain and the pure parts of the
// adapters are exercised here, while anything that needs a real canvas/DOM is
// covered by the Playwright e2e suite (which reads the 2D framebuffer surface).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    watch: false,
  },
})
