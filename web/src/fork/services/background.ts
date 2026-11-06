// Fork: what's under the map's data, chosen in Settings → Background
// (modules/background): the background map in its high contrast colours or its
// original ones (applied by modules/map-sources/palette.ts), or satellite imagery,
// alone or with the map's roads (drawn by modules/satellite, which says here what
// imagery there is). They meet here: modules don't import each other. Kept in this
// browser; the map in high contrast at first.
import { readText, writeText } from '../core/storage.ts'

export type MapColours = 'original' | 'contrast'
export type BackgroundMode = 'map' | 'satellite' | 'hybrid'
/** One choice of the section: the map in a colouring, or imagery. */
export type BackgroundChoice = MapColours | Exclude<BackgroundMode, 'map'>

export type Bounds = [west: number, south: number, east: number, north: number]

/** The satellite imagery there is (modules/satellite). */
export interface Imagery {
  /** Its last zoom. */
  maxzoom: number
  /** Whether it covers any of a view (false: the imagery choices can't be picked). */
  covers: (view: Bounds) => Promise<boolean>
}

const COLOURS_KEY = 'oim-map-colours'
const MODE_KEY = 'oim-background-mode'

/** The map's colours and the mode as kept (anything else: the defaults). */
export function readBackground(colours: string | null, mode: string | null) {
  return {
    colours: (colours === 'original' ? 'original' : 'contrast') as MapColours,
    mode: (mode === 'satellite' || mode === 'hybrid' ? mode : 'map') as BackgroundMode
  }
}

const kept = readBackground(readText(COLOURS_KEY), readText(MODE_KEY))
let colours = kept.colours
let mode = kept.mode
let imagery: Imagery | null = null
const listeners: (() => void)[] = []

export const background = {
  /** The map's colouring (also kept while imagery is shown, for when the map comes back). */
  colours: (): MapColours => colours,
  /** The map, or imagery: only once there is some. */
  mode: (): BackgroundMode => (imagery ? mode : 'map'),
  /** What the section shows chosen. */
  choice: (): BackgroundChoice => (background.mode() === 'map' ? colours : (mode as BackgroundChoice)),
  choose(choice: BackgroundChoice) {
    if (choice === 'original' || choice === 'contrast') {
      colours = choice
      mode = 'map'
    } else mode = choice
    writeText(COLOURS_KEY, colours)
    writeText(MODE_KEY, mode)
    for (const listener of listeners) listener()
  },
  /** Called after each choice. */
  onChange(listener: () => void) {
    listeners.push(listener)
  },
  imagery: (): Imagery | null => imagery,
  /** The satellite module, when it has imagery. */
  offerImagery(offered: Imagery) {
    imagery = offered
  }
}
