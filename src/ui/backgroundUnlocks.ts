import { BACKGROUNDS, type BackgroundKey } from '../assets/backgrounds'

const BACKGROUND_UNLOCKS_STORAGE_KEY = 'bemerged_background_unlocks_v1'
export const DEFAULT_BEMERGED_BACKGROUND: BackgroundKey = 'DarkBeing'

export type BemergedBackgroundUnlockState = {
  unlockedBackgrounds: BackgroundKey[]
  completedUniqueKeys: string[]
}

function isBackgroundKey(value: string): value is BackgroundKey {
  return Object.prototype.hasOwnProperty.call(BACKGROUNDS, value)
}

function normalizeBackgrounds(values: unknown): BackgroundKey[] {
  const out = new Set<BackgroundKey>([DEFAULT_BEMERGED_BACKGROUND])
  if (Array.isArray(values)) {
    for (const value of values) {
      const key = String(value || '').trim()
      if (isBackgroundKey(key)) {
        out.add(key)
      }
    }
  }
  return Array.from(out)
}

function normalizeCompletedUniqueKeys(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean))).sort()
}

function hashString(value: string): number {
  let hash = 0
  const text = String(value || '')
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0
  }
  return hash >>> 0
}

function persistState(state: BemergedBackgroundUnlockState): void {
  try {
    window.localStorage.setItem(BACKGROUND_UNLOCKS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    void 0
  }
}

export function loadBemergedBackgroundUnlockState(): BemergedBackgroundUnlockState {
  try {
    const raw = window.localStorage.getItem(BACKGROUND_UNLOCKS_STORAGE_KEY)
    if (!raw) {
      return {
        unlockedBackgrounds: [DEFAULT_BEMERGED_BACKGROUND],
        completedUniqueKeys: [],
      }
    }
    const parsed = JSON.parse(raw) as Partial<BemergedBackgroundUnlockState>
    return {
      unlockedBackgrounds: normalizeBackgrounds(parsed.unlockedBackgrounds),
      completedUniqueKeys: normalizeCompletedUniqueKeys(parsed.completedUniqueKeys),
    }
  } catch {
    return {
      unlockedBackgrounds: [DEFAULT_BEMERGED_BACKGROUND],
      completedUniqueKeys: [],
    }
  }
}

export function syncBemergedBackgroundUnlocks(completedUniqueKeys: string[]): {
  state: BemergedBackgroundUnlockState
  newlyUnlockedBackgrounds: BackgroundKey[]
} {
  const current = loadBemergedBackgroundUnlockState()
  const normalizedCompleted = normalizeCompletedUniqueKeys(completedUniqueKeys)
  const unlocked = new Set<BackgroundKey>(current.unlockedBackgrounds)
  const processed = new Set(current.completedUniqueKeys)
  const pool = (Object.keys(BACKGROUNDS) as BackgroundKey[]).filter(key => key !== DEFAULT_BEMERGED_BACKGROUND)
  const newlyUnlockedBackgrounds: BackgroundKey[] = []

  for (const uniqueKey of normalizedCompleted) {
    if (processed.has(uniqueKey)) continue
    processed.add(uniqueKey)

    const lockedPool = pool.filter(key => !unlocked.has(key))
    if (lockedPool.length <= 0) continue

    const index = hashString(`${uniqueKey}:${lockedPool.length}:${processed.size}`) % lockedPool.length
    const background = lockedPool[index]
    unlocked.add(background)
    newlyUnlockedBackgrounds.push(background)
  }

  const nextState: BemergedBackgroundUnlockState = {
    unlockedBackgrounds: Array.from(unlocked),
    completedUniqueKeys: Array.from(processed).sort(),
  }
  persistState(nextState)
  return {
    state: nextState,
    newlyUnlockedBackgrounds,
  }
}
