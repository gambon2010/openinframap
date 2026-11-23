// Fork: whether debug info is shown, switched in Settings by the debug module and kept
// in this browser; other modules show their own extra numbers while it's on (the line
// of sight's profile).
import { readText, writeText } from '../core/storage.ts'

const KEY = 'oim-debug'

const listeners: ((on: boolean) => void)[] = []

export const debugMode = {
  get on(): boolean {
    return readText(KEY) === '1'
  },
  set(on: boolean) {
    if (on === this.on) return
    writeText(KEY, on ? '1' : '0')
    for (const listener of listeners) listener(on)
  },
  onChange(listener: (on: boolean) => void) {
    listeners.push(listener)
  }
}
