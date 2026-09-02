/**
 * A small production-safe performance meter: rolling frames-per-second
 * and the loop body's own work time, refreshed twice a second. Hidden by
 * default; the settings panel shows it. (stats.js stays dev-only.)
 */
export interface FpsMeter {
  root: HTMLElement;
  /** Feed one frame: wall-clock gap and loop-body work, both in ms. */
  sample(frameMs: number, workMs: number, tier: string): void;
  setVisible(v: boolean): void;
  isVisible(): boolean;
}

export function createFpsMeter(doc: Document = document): FpsMeter {
  const root = doc.createElement("div");
  root.id = "fps";
  root.hidden = true;
  root.setAttribute("aria-live", "off");
  let accTime = 0;
  let accWork = 0;
  let frames = 0;
  let maxWork = 0;
  return {
    root,
    sample(frameMs, workMs, tier) {
      accTime += frameMs;
      accWork += workMs;
      frames++;
      if (workMs > maxWork) maxWork = workMs;
      if (accTime >= 500) {
        const fps = Math.round((frames * 1000) / accTime);
        const avg = accWork / frames;
        root.textContent = `${fps} fps · ${avg.toFixed(2)} ms · max ${maxWork.toFixed(1)} ms · ${tier}`;
        accTime = 0;
        accWork = 0;
        frames = 0;
        maxWork = 0;
      }
    },
    setVisible(v) {
      root.hidden = !v;
    },
    isVisible: () => !root.hidden
  };
}
