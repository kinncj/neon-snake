// The WebGL2 surface the FX adapter touches that lib.dom leaves untyped.
interface WebGL2LoseContext {
  loseContext(): void;
  restoreContext(): void;
}
interface WebGL2RenderingContext {
  getExtension(name: "WEBGL_lose_context"): WebGL2LoseContext | null;
}
