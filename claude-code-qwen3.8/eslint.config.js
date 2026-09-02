import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Flat ESLint config. `no-undef` is delegated to `tsc` (the DOM lib + strict
// mode already reject undefined identifiers), so we turn it off and rely on the
// TypeScript pass for symbol resolution. The domain purity block below is the
// lint-enforced boundary for app/domain.
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'docs/**',
      'coverage/**',
      'test-results/**',
      'common/**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,js,mjs}'],
    rules: {
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // ---- the domain lint block -------------------------------------------
    // app/domain/** is pure: no DOM, no timers, no clock, no audio, no storage,
    // no Math.random / Date. This fails the build, not just the review.
    files: ['app/domain/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'domain must not reference the DOM global' },
        { name: 'document', message: 'domain must not reference the DOM global' },
        { name: 'navigator', message: 'domain must not reference the DOM global' },
        { name: 'location', message: 'domain must not reference the DOM global' },
        { name: 'performance', message: 'domain must not read a clock' },
        { name: 'requestAnimationFrame', message: 'domain must not schedule frames' },
        { name: 'cancelAnimationFrame', message: 'domain must not schedule frames' },
        { name: 'setTimeout', message: 'domain must not use timers' },
        { name: 'clearTimeout', message: 'domain must not use timers' },
        { name: 'setInterval', message: 'domain must not use timers' },
        { name: 'clearInterval', message: 'domain must not use timers' },
        { name: 'queueMicrotask', message: 'domain must not use timers' },
        { name: 'AudioContext', message: 'domain must not use audio' },
        { name: 'webkitAudioContext', message: 'domain must not use audio' },
        { name: 'localStorage', message: 'domain must not touch storage' },
        { name: 'sessionStorage', message: 'domain must not touch storage' },
        { name: 'alert', message: 'domain must not show UI' },
        { name: 'console', message: 'domain must not log' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'domain must not call Math.random (use the seeded PRNG)',
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'domain must not call Date.now',
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='parse']",
          message: 'domain must not call Date.parse',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='pow'][arguments.length='1']",
          message: 'single-arg Math.pow is a no-op; use the value directly',
        },
        {
          selector: "NewExpression[callee.name='AudioContext']",
          message: 'domain must not construct an AudioContext',
        },
        {
          selector: "NewExpression[callee.name='webkitAudioContext']",
          message: 'domain must not construct an AudioContext',
        },
      ],
    },
  },
)
