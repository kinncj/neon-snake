/**
 * A tiny on-screen frame-rate meter. Production-safe (no devDependency): it
 * runs its own requestAnimationFrame loop only while enabled, counting frames
 * over a ~500 ms window and writing the integer to a single DOM node. When
 * disabled it stops scheduling frames, so it costs nothing in the steady
 * state. Toggled from the settings panel.
 */
export interface FpsMeterApi {
  setEnabled(v: boolean): void;
  isEnabled(): boolean;
  dispose(): void;
}

export function buildFpsMeter(root: HTMLElement): FpsMeterApi {
  const el = document.createElement("div");
  el.id = "fps-meter";
  el.style.cssText =
    "position:absolute;left:12px;bottom:12px;z-index:11;display:none;" +
    "font:700 12px 'Courier New',monospace;letter-spacing:1px;" +
    "color:#22ffb0;text-shadow:0 0 8px rgba(34,255,176,0.7);" +
    "background:rgba(3,4,12,0.7);border:1px solid rgba(34,255,176,0.4);" +
    "border-radius:3px;padding:3px 8px;pointer-events:none;";
  root.append(el);

  let enabled = false;
  let frames = 0;
  let last = 0;
  let raf = 0;

  function loop(): void {
    if (!enabled) return;
    frames++;
    const now = performance.now();
    const dt = now - last;
    if (dt >= 500) {
      const fps = Math.round((frames * 1000) / dt);
      el.textContent = `${fps} FPS`;
      frames = 0;
      last = now;
    }
    raf = requestAnimationFrame(loop);
  }

  return {
    setEnabled(v: boolean): void {
      if (v === enabled) return;
      enabled = v;
      el.style.display = v ? "block" : "none";
      if (v) {
        frames = 0;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    isEnabled(): boolean {
      return enabled;
    },
    dispose(): void {
      if (raf) cancelAnimationFrame(raf);
      if (root.contains(el)) root.removeChild(el);
    }
  };
}
