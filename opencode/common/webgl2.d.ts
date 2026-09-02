// Ambient declarations for the WebGL2 surface the FX adapter touches that
// lib.dom does not type. Kept minimal on purpose — no @webgpu/types and no
// other type packages are dependencies.
interface WebGL2LoseContext {
  loseContext(): void;
  restoreContext(): void;
}
interface WebGL2RenderingContext {
  getExtension(name: "WEBGL_lose_context"): WebGL2LoseContext | null;
}
