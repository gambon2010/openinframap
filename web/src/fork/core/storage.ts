// Fork: this browser's storage (localStorage), for small per-browser choices. It can
// be missing or blocked (a private window, storage turned off): reading then gives
// nothing (null, or the fallback) and writing does nothing, so callers never need a
// try/catch. (Unsaved My layers changes have their own: userlayers/state/local.ts.)

/** A stored text, null if there's none or storage can't be read. */
export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Store a text (nothing happens if storage is blocked: kept for this page only). */
export function writeText(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembered.
  }
}

/** A stored JSON value, `fallback` if there's none, it isn't JSON or storage is blocked. */
export function readJson<T>(key: string, fallback: T): T {
  const text = readText(key)
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/** Store a value as JSON (nothing happens if storage is blocked). */
export function writeJson(key: string, value: unknown) {
  writeText(key, JSON.stringify(value))
}
