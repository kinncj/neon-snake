import { defineConfig } from 'vite'

// Relative base so the production build runs from any sub-path (GitHub Pages
// publishes each package under /<package>/). public/ is copied to dist/ verbatim,
// so the CRT bezel SVG at public/crt-tv.svg is served at ./crt-tv.svg.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
})
