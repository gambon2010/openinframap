// Fork: the 3D view, on or off (the 3D button, modules/view3d): the map can be tilted
// and turned, and buildings rise (modules/buildings). They meet here: modules don't
// import each other. Kept in this browser; off at first.
import { readText, writeText } from '../core/storage.ts'

const KEY = 'oim-3d'

let on = readText(KEY) === 'on'
const listeners: (() => void)[] = []

export const view3d = {
  on: (): boolean => on,
  set(value: boolean) {
    if (value === on) return
    on = value
    writeText(KEY, on ? 'on' : 'off')
    for (const listener of listeners) listener()
  },
  /** Called after each change. */
  onChange(listener: () => void) {
    listeners.push(listener)
  }
}
