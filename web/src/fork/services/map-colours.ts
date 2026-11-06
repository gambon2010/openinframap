// Fork: which colours the background map has: upstream's original ones, or the high
// contrast palette (modules/map-sources/palette.ts). Chosen in Settings →
// Background (modules/satellite), applied by the palette; they meet here (modules
// don't import each other). Kept in this browser; high contrast at first.
import { readText, writeText } from '../core/storage.ts'

export type MapColours = 'original' | 'contrast'

const KEY = 'oim-map-colours'
const listeners: ((colours: MapColours) => void)[] = []
let current: MapColours = readText(KEY) === 'original' ? 'original' : 'contrast'

export const mapColours = {
  get(): MapColours {
    return current
  },
  set(colours: MapColours) {
    if (colours === current) return
    current = colours
    writeText(KEY, colours)
    for (const listener of listeners) listener(colours)
  },
  onChange(listener: (colours: MapColours) => void) {
    listeners.push(listener)
  }
}
