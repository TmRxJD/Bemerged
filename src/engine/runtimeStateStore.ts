import type { BemergedRuntimeState } from './Match3Scene'

const DB_NAME = 'bemerged-runtime'
const DB_VERSION = 1
const STORE_NAME = 'runtime'
const RECORD_ID = 'current'
const LOCAL_STORAGE_KEY = 'bemerged_runtime_state_v1'

type RuntimeRecord = {
  id: string
  updatedAt: number
  state: BemergedRuntimeState
}

function loadRuntimeRecordFromLocalStorage(): RuntimeRecord | null {
  if (typeof window === 'undefined' || !window.localStorage) return null

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RuntimeRecord | BemergedRuntimeState | null
    if (!parsed || typeof parsed !== 'object') return null

    if ('state' in parsed && parsed.state && parsed.state.version === 1) {
      return {
        id: String(parsed.id || RECORD_ID),
        updatedAt: Math.max(0, Math.floor(Number(parsed.updatedAt) || 0)),
        state: parsed.state,
      }
    }

    if ('version' in parsed && parsed.version === 1) {
      return {
        id: RECORD_ID,
        updatedAt: 0,
        state: parsed,
      }
    }

    return null
  } catch {
    return null
  }
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
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onerror = () => reject(request.error || new Error('Failed to open runtime IndexedDB'))
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

export async function loadBemergedRuntimeState(): Promise<BemergedRuntimeState | null> {
  const localRecord = loadRuntimeRecordFromLocalStorage()
  if (typeof indexedDB === 'undefined') return localRecord?.state || null

  try {
    const indexedDbRecord = await withIndexedDb(async db => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const row = await new Promise<RuntimeRecord | null>((resolve, reject) => {
        const request = store.get(RECORD_ID)
        request.onerror = () => reject(request.error || new Error('Failed to read runtime state'))
        request.onsuccess = () => resolve((request.result as RuntimeRecord | undefined) || null)
      })

      if (!row || !row.state || row.state.version !== 1) return null
      return row
    })

    if (!indexedDbRecord) return localRecord?.state || null
    if (!localRecord) return indexedDbRecord.state

    return indexedDbRecord.updatedAt >= localRecord.updatedAt
      ? indexedDbRecord.state
      : localRecord.state
  } catch {
    return localRecord?.state || null
  }
}

export async function saveBemergedRuntimeState(state: BemergedRuntimeState): Promise<void> {
  const record: RuntimeRecord = {
    id: RECORD_ID,
    updatedAt: Date.now(),
    state,
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(record))
    } catch {
      void 0
    }
  }

  if (typeof indexedDB === 'undefined') return

  try {
    await withIndexedDb(async db => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      await new Promise<void>((resolve, reject) => {
        const request = store.put(record)
        request.onerror = () => reject(request.error || new Error('Failed to persist runtime state'))
        request.onsuccess = () => resolve()
      })

      await new Promise<void>((resolve, reject) => {
        tx.onerror = () => reject(tx.error || new Error('Failed to commit runtime state transaction'))
        tx.oncomplete = () => resolve()
      })
    })
  } catch {
    void 0
  }
}
