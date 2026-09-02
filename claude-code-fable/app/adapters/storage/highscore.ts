/**
 * High score in localStorage, guarded by a checksum over a build-time
 * constant. A tampered or malformed record is discarded and the score
 * resets. This is deterrence against casual edits, not security: anyone
 * who reads the bundle can forge a record, and that is acceptable for a
 * client-only game.
 */
export const HIGHSCORE_KEY = "snake.highscore";

/** Mixed into the checksum; a new build invalidates old records on purpose. */
export const INTEGRITY_SALT = "neon-snake/hs/1";

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function checksum(score: number, salt = INTEGRITY_SALT): string {
  return fnv1a(salt + ":" + score).toString(16).padStart(8, "0");
}

export function encode(score: number, salt = INTEGRITY_SALT): string {
  return score + ":" + checksum(score, salt);
}

/** Returns the score, or null when the record is missing, malformed or tampered. */
export function decode(record: string | null, salt = INTEGRITY_SALT): number | null {
  if (record === null) return null;
  const i = record.indexOf(":");
  if (i <= 0) return null;
  const score = Number(record.slice(0, i));
  if (!Number.isInteger(score) || score < 0) return null;
  if (record.slice(i + 1) !== checksum(score, salt)) return null;
  return score;
}

export interface HighScore {
  get(): number;
  /** Records `score` if it beats the stored one; returns true when it did. */
  submit(score: number): boolean;
  reset(): void;
}

export function createHighScore(storage: Storage | null, salt = INTEGRITY_SALT): HighScore {
  let current = 0;
  const read = (): void => {
    if (!storage) return;
    let raw: string | null = null;
    try {
      raw = storage.getItem(HIGHSCORE_KEY);
    } catch {
      raw = null;
    }
    const v = decode(raw, salt);
    if (v === null) {
      current = 0;
      if (raw !== null) {
        try {
          storage.removeItem(HIGHSCORE_KEY);
        } catch {
          /* ignore */
        }
      }
    } else {
      current = v;
    }
  };
  const write = (): void => {
    if (!storage) return;
    try {
      storage.setItem(HIGHSCORE_KEY, encode(current, salt));
    } catch {
      /* quota or privacy mode: keep the in-memory value */
    }
  };
  read();
  return {
    get: () => current,
    submit(score) {
      if (score <= current) return false;
      current = score;
      write();
      return true;
    },
    reset() {
      current = 0;
      write();
    }
  };
}
