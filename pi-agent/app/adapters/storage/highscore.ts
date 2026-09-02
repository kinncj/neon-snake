/**
 * High-score persistence. The only module that touches localStorage for the
 * game's own data. All access is guarded: private-mode browsers and
 * storage-disabled environments degrade to "no high score" instead of
 * throwing.
 */
const KEY = "snake.best";

/** Load the persisted best score; 0 when absent or unreadable. */
export function loadBest(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Persist the best score. Failures are silent (the game must not crash). */
export function saveBest(best: number): void {
  try {
    window.localStorage.setItem(KEY, String(Math.floor(best)));
  } catch {
    // storage unavailable — in-memory best still works for this session
  }
}

/** Clear persisted data (debug / uninstall). */
export function clearBest(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // same as above
  }
}
