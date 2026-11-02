// Fork: your measuring preferences, as the drawing and the kinds need them: the
// north bearings are measured from (set in My layers' settings), and the distances
// new range rings get (the last set on a ring's card). Kept per account in
// personal.ts: the store loads them here and saves what changes.
import { North } from './north.ts'
import { DEFAULT_RADII } from './features.ts'

export interface MeasurePrefs {
  north: North
  radii: number[]
}

const listeners: (() => void)[] = []

export const measurePrefs: MeasurePrefs & {
  set(changes: Partial<MeasurePrefs>): void
  onChange(listener: () => void): void
} = {
  north: 'true',
  radii: DEFAULT_RADII,
  set(changes) {
    const changed = Object.entries(changes).some(
      ([k, v]) => JSON.stringify(v) !== JSON.stringify(this[k as keyof MeasurePrefs])
    )
    Object.assign(this, changes)
    if (changed) for (const listener of listeners) listener()
  },
  onChange(listener) {
    listeners.push(listener)
  }
}
