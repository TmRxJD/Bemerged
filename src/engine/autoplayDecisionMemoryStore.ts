const DB_NAME = 'bemerged-autoplay-decision-memory'
const DB_VERSION = 1
const STORE_NAME = 'memories'

export type PersistedAutoplayStrategyDelta = {
  contractVersion: 'bemerged-strategy-delta-v2'
  avoid_patterns: string[]
  prefer_patterns: string[]
  new_tests: string[]
  discovered_bugs: string[]
  heuristics_to_adjust: string[]
}

export type PersistedAutoplayRewardEntry = {
  actionType: string
  total: number
  objective: number
  shards: number
  time: number
  risk: number
  moved: boolean
  merged: boolean
  reason: string
  elapsedSeconds: number
}

export type PersistedAutoplayMemoryRecord = {
  id: string
  modelId: string
  version: 1 | 2
  updatedAt: number
  stepCount: number
  recentOutcomes: string[]
  rewardHistory: PersistedAutoplayRewardEntry[]
  recentStrategyDeltas?: PersistedAutoplayStrategyDelta[]
  cleanLessons?: PersistedAutoplayStrategyDelta
}

function withIndexedDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }

  return new Promise<T>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('modelId', 'modelId', { unique: false })
      }
    }

    request.onerror = () => reject(request.error || new Error('Failed to open autoplay memory database'))
    request.onsuccess = async () => {
      const db = request.result
      try {
        const result = await run(db)
        resolve(result)
      } catch (error) {
        reject(error)
      } finally {
        db.close()
      }
    }
  })
}

function toMemoryId(modelId: string): string {
  return `autoplay-memory:${String(modelId || 'unknown').trim() || 'unknown'}`
}

export async function loadAutoplayDecisionMemory(modelId: string): Promise<PersistedAutoplayMemoryRecord | null> {
  if (typeof indexedDB === 'undefined') return null

  try {
    return await withIndexedDb(async db => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const row = await new Promise<PersistedAutoplayMemoryRecord | null>((resolve, reject) => {
        const request = store.get(toMemoryId(modelId))
        request.onerror = () => reject(request.error || new Error('Failed to load autoplay memory record'))
        request.onsuccess = () => {
          const value = (request.result as PersistedAutoplayMemoryRecord | undefined) || null
          resolve(value && value.version === 1 ? value : null)
        }
      })

      return row
    })
  } catch {
    return null
  }
}

export async function saveAutoplayDecisionMemory(input: {
  modelId: string
  stepCount: number
  recentOutcomes: string[]
  rewardHistory: PersistedAutoplayRewardEntry[]
  recentStrategyDeltas?: PersistedAutoplayStrategyDelta[]
  cleanLessons?: PersistedAutoplayStrategyDelta
}): Promise<void> {
  if (typeof indexedDB === 'undefined') return

  const modelId = String(input.modelId || 'unknown').trim() || 'unknown'
  const record: PersistedAutoplayMemoryRecord = {
    id: toMemoryId(modelId),
    modelId,
    version: 2,
    updatedAt: Date.now(),
    stepCount: Math.max(0, Math.floor(Number(input.stepCount) || 0)),
    recentOutcomes: Array.isArray(input.recentOutcomes)
      ? input.recentOutcomes.map(value => String(value || '').trim()).filter(Boolean).slice(-24)
      : [],
    rewardHistory: Array.isArray(input.rewardHistory)
      ? input.rewardHistory
        .map(item => ({
          actionType: String(item.actionType || '').trim(),
          total: Number(item.total || 0),
          objective: Number(item.objective || 0),
          shards: Number(item.shards || 0),
          time: Number(item.time || 0),
          risk: Number(item.risk || 0),
          moved: !!item.moved,
          merged: !!item.merged,
          reason: String(item.reason || '').trim(),
          elapsedSeconds: Math.max(0, Math.floor(Number(item.elapsedSeconds) || 0)),
        }))
        .slice(-32)
      : [],
    recentStrategyDeltas: Array.isArray(input.recentStrategyDeltas)
      ? input.recentStrategyDeltas
        .map(item => ({
          contractVersion: 'bemerged-strategy-delta-v2' as const,
          avoid_patterns: Array.isArray(item.avoid_patterns)
            ? item.avoid_patterns.map(value => String(value || '').trim()).filter(Boolean).slice(0, 32)
            : [],
          prefer_patterns: Array.isArray(item.prefer_patterns)
            ? item.prefer_patterns.map(value => String(value || '').trim()).filter(Boolean).slice(0, 32)
            : [],
          new_tests: Array.isArray(item.new_tests)
            ? item.new_tests.map(value => String(value || '').trim()).filter(Boolean).slice(0, 32)
            : [],
          discovered_bugs: Array.isArray(item.discovered_bugs)
            ? item.discovered_bugs.map(value => String(value || '').trim()).filter(Boolean).slice(0, 32)
            : [],
          heuristics_to_adjust: Array.isArray(item.heuristics_to_adjust)
            ? item.heuristics_to_adjust.map(value => String(value || '').trim()).filter(Boolean).slice(0, 32)
            : [],
        }))
        .slice(-12)
      : [],
    cleanLessons: input.cleanLessons
      ? {
        contractVersion: 'bemerged-strategy-delta-v2',
        avoid_patterns: Array.isArray(input.cleanLessons.avoid_patterns)
          ? input.cleanLessons.avoid_patterns.map(value => String(value || '').trim()).filter(Boolean).slice(0, 32)
          : [],
        prefer_patterns: Array.isArray(input.cleanLessons.prefer_patterns)
          ? input.cleanLessons.prefer_patterns.map(value => String(value || '').trim()).filter(Boolean).slice(0, 32)
          : [],
        new_tests: Array.isArray(input.cleanLessons.new_tests)
          ? input.cleanLessons.new_tests.map(value => String(value || '').trim()).filter(Boolean).slice(0, 32)
          : [],
        discovered_bugs: Array.isArray(input.cleanLessons.discovered_bugs)
          ? input.cleanLessons.discovered_bugs.map(value => String(value || '').trim()).filter(Boolean).slice(0, 32)
          : [],
        heuristics_to_adjust: Array.isArray(input.cleanLessons.heuristics_to_adjust)
          ? input.cleanLessons.heuristics_to_adjust.map(value => String(value || '').trim()).filter(Boolean).slice(0, 32)
          : [],
      }
      : undefined,
  }

  try {
    await withIndexedDb(async db => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      await new Promise<void>((resolve, reject) => {
        const request = store.put(record)
        request.onerror = () => reject(request.error || new Error('Failed to persist autoplay memory record'))
        request.onsuccess = () => resolve()
      })

      await new Promise<void>((resolve, reject) => {
        tx.onerror = () => reject(tx.error || new Error('Failed to commit autoplay memory transaction'))
        tx.oncomplete = () => resolve()
      })
    })
  } catch {
    void 0
  }
}
