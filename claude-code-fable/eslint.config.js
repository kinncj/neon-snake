import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist", "node_modules", "test-results"]
  },
  ...tseslint.configs.recommended,
  {
    // The domain is pure: no adapters, no runtime, no platform globals, no
    // wall clock, no entropy. A violation fails the build, not the review.
    files: ["app/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: ["**/adapters/**", "**/runtime/**", "**/*.css"]
      }],
      "no-restricted-globals": ["error",
        "window", "document", "navigator", "performance",
        "requestAnimationFrame", "setTimeout", "setInterval", "AudioContext"],
      "no-restricted-properties": ["error",
        { object: "Math", property: "random", message: "use domain/rng" },
        { object: "Date",  property: "now",    message: "domain is timeless" }]
    }
  }
];
