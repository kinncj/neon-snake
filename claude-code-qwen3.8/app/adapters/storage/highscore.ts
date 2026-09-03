// Client-side high-score persistence. The score is stored with a checksum
// (FNV-1a over a build-time salt + the score) so a casual localStorage edit that
// changes the score invalidates the checksum and the value is discarded (reset
// to 0). This is deterrence, not security: the salt ships in the bundle, so a
// determined user can recompute the checksum and forge a score. That limitation
// is stated plainly in the build-report certification — the goal is to deter
// casual tampering, not to defend against a determined one.
//
// The adapter is the only thing that touches this storage; the domain stays
// storage-free (the state's `highScore` field is mirrored to/from here).
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface HighscoreStore {
  /** Load + verify. Returns the score, or 0 when missing/invalid/tampered. */
  load(): number
  /** Persist a score with its checksum. */
  save(score: number): void
  /** Clear the stored high score. */
  clear(): void
}

/** localStorage key (stable across the build). */
export const HS_KEY: string = 'snake.highscore'

// Build-time integrity salt. Changing it invalidates scores stored by other
// builds (a fresh start on a new build). Deterrence, not secrecy.
const SALT: string = 'neon-snake/hs/v1'

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function fnv1a(str: string): number {
  let h = FNV_OFFSET
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, FNV_PRIME)
  }
  return h >>> 0
}

function checksum(score: number): string {
  return fnv1a(`${SALT}:${score}`).toString(16).padStart(8, '0')
}

export function createHighscore(storage: StorageLike): HighscoreStore {
  function load(): number {
    try {
      const raw = storage.getItem(HS_KEY)
      if (raw === null) return 0
      const parsed = JSON.parse(raw) as { s?: unknown; c?: unknown }
      const s = typeof parsed.s === 'number' ? parsed.s : NaN
      if (!Number.isFinite(s) || s < 0) return 0
      const score = Math.floor(s)
      if (checksum(score) !== (parsed.c as string | undefined)) return 0 // tampered → discard
      return score
    } catch {
      return 0 // malformed JSON or storage unavailable → discard
    }
  }

  function save(score: number): void {
    try {
      const s = Math.max(0, Math.floor(score))
      storage.setItem(HS_KEY, JSON.stringify({ s, c: checksum(s) }))
    } catch {
      // storage unavailable (private mode): in-session highScore still holds
    }
  }

  function clear(): void {
    try {
      storage.removeItem(HS_KEY)
    } catch {
      // ignore
    }
  }

  return { load, save, clear }
}
