// Fork: what My layers keeps in this browser: the unsaved changes (so a reload or
// crash doesn't lose them) and what they started from (the hidden layers and
// folders are personal.ts).
//
// The unsaved changes go in IndexedDB, which has room for big imported files
// (localStorage, used before, holds about 5 MB per site); the first time, what
// localStorage had is moved there. Where there's no IndexedDB, localStorage. When
// they can't be kept (storage full or blocked, a private window), `trouble` says
// why and the page warns: they last only until the page closes, so Save.
import { Change } from '../model/model.ts'
import type { Bases } from './reconcile.ts'

const PENDING_KEY = 'oim-userlayers-pending'
const BASES_KEY = 'oim-userlayers-bases'

export interface Kept {
  pending: Change[]
  bases: Bases
}

interface Backend {
  load(): Promise<Kept>
  /** Keep both (the newest wins; a backend may wait a moment to group writes). */
  save(kept: Kept): Promise<void>
  /** Write what's waiting now (the page is closing). */
  flush(): void
}

// --- localStorage: synchronous, small ---------------------------------------------

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

const storageBackend: Backend = {
  load: async () => ({ pending: readStorage(PENDING_KEY, []), bases: readStorage(BASES_KEY, {}) }),
  save: async ({ pending, bases }) => {
    // Throws when full or blocked: the caller reports it.
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    localStorage.setItem(BASES_KEY, JSON.stringify(bases))
  },
  flush: () => undefined
}

// --- IndexedDB: asynchronous, big -------------------------------------------------

const DB = 'oim-userlayers'
const STORE = 'kept'

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function openDb(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB, 1)
  open.onupgradeneeded = () => open.result.createObjectStore(STORE)
  return request(open)
}

function idbBackend(): Backend {
  let db: Promise<IDBDatabase> | undefined
  const database = () => (db ??= openDb())
  let waiting: Kept | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let done: { resolve: () => void; reject: (e: unknown) => void }[] = []

  const write = async () => {
    clearTimeout(timer)
    const kept = waiting
    const promises = done
    waiting = null
    done = []
    if (!kept) return
    try {
      const tx = (await database()).transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(kept.pending, PENDING_KEY)
      tx.objectStore(STORE).put(kept.bases, BASES_KEY)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('not kept'))
      })
      promises.forEach((p) => p.resolve())
    } catch (e) {
      promises.forEach((p) => p.reject(e))
    }
  }

  return {
    async load() {
      const store = (await database()).transaction(STORE).objectStore(STORE)
      const [pending, bases] = await Promise.all([
        request(store.get(PENDING_KEY)) as Promise<Change[] | undefined>,
        request(store.get(BASES_KEY)) as Promise<Bases | undefined>
      ])
      if (pending !== undefined) return { pending, bases: bases ?? {} }
      // The first time: what localStorage kept, moved here.
      const old = await storageBackend.load()
      if (old.pending.length) {
        await this.save(old)
        await write()
      }
      try {
        localStorage.removeItem(PENDING_KEY)
        localStorage.removeItem(BASES_KEY)
      } catch {
        // Nothing there to remove.
      }
      return old
    },
    // Edits come quickly (dragging, typing): written a moment after the last one.
    save(kept) {
      waiting = kept
      clearTimeout(timer)
      timer = setTimeout(() => void write(), 300)
      return new Promise((resolve, reject) => done.push({ resolve, reject }))
    },
    flush: () => void write()
  }
}

// ---------------------------------------------------------------------------------

const backend: Backend = typeof indexedDB !== 'undefined' ? idbBackend() : storageBackend

let current: Kept = { pending: [], bases: {} }
const troubleListeners: (() => void)[] = []
// Nothing is written before what was kept has been read (load()): an edit made
// meanwhile would overwrite it. The store writes everything once it has merged them.
let loaded = false

function keep() {
  if (!loaded) return
  backend.save(current).then(
    () => setTrouble(null),
    (e: unknown) => setTrouble(String((e as Error)?.name ?? e))
  )
}

function setTrouble(value: string | null) {
  if (local.trouble === value) return
  local.trouble = value
  for (const listener of troubleListeners) listener()
}

// The page is closing: write what's waiting.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => backend.flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') backend.flush()
  })
}

export const local = {
  /** The unsaved changes and their bases, as kept (once, when the page opens).
   * Until then nothing is written: the caller merges what it has with these and
   * sets them again. */
  async load(): Promise<Kept> {
    let kept: Kept = { pending: [], bases: {} }
    try {
      kept = await backend.load()
    } catch (e) {
      setTrouble(String((e as Error)?.name ?? e))
    }
    loaded = true
    return kept
  },
  setPending(pending: Change[]) {
    current = { ...current, pending }
    keep()
  },
  // How what the unsaved changes touch was when they started (reconcile.ts).
  setBases(bases: Bases) {
    current = { ...current, bases }
    keep()
  },
  /** Why the unsaved changes can't be kept in this browser (null: they are). */
  trouble: null as string | null,
  onTrouble(listener: () => void) {
    troubleListeners.push(listener)
  }
}
