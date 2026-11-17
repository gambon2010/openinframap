// Fork: what's under the map's data, chosen in Settings → Background
// (modules/background): the background map (in the fork's colours:
// modules/map-sources/palette.ts) or satellite imagery (drawn by modules/satellite,
// which says here what imagery there is). They meet here: modules don't import each
// other. Kept in this browser; the map at first.
import type { Map } from 'maplibre-gl'
import { readText, writeText } from '../core/storage.ts'

export type BackgroundMode = 'map' | 'satellite'

export type Bounds = [west: number, south: number, east: number, north: number]

/** The satellite imagery there is (modules/satellite). */
export interface Imagery {
  /** Its last zoom. */
  maxzoom: number
  /** Whether it covers any of a view (false: imagery can't be picked). */
  covers: (view: Bounds) => Promise<boolean>
}

const MODE_KEY = 'oim-background-mode'

/** The mode as kept (anything else: the map). */
export function readMode(kept: string | null): BackgroundMode {
  return kept === 'satellite' ? kept : 'map'
}

let mode = readMode(readText(MODE_KEY))
let imagery: Imagery | null = null
const listeners: (() => void)[] = []

export const background = {
  /** What's shown: the map, or imagery once there is some. */
  mode: (): BackgroundMode => (imagery ? mode : 'map'),
  /** What the section shows chosen (imagery may be chosen before it's known). */
  chosen: (): BackgroundMode => mode,
  choose(chosen: BackgroundMode) {
    mode = chosen
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
    // The mode kept may be imagery: it shows now.
    for (const listener of listeners) listener()
  }
}

type PaintProperty = Parameters<Map['setPaintProperty']>[1]
type PaintValue = Parameters<Map['setPaintProperty']>[2]

/** A paint value over the map, and over imagery. */
export interface BackgroundValues {
  map: PaintValue
  imagery: PaintValue
}

/**
 * A paint property that follows the background: one value over the map, another
 * over imagery (e.g. dark outlines on the map, white ones on satellite photos).
 * Applied now and after each change.
 */
export function followBackground(
  map: Map,
  layerId: string,
  property: PaintProperty,
  values: BackgroundValues
) {
  const apply = () => {
    if (!map.getLayer(layerId)) return
    map.setPaintProperty(layerId, property, background.mode() === 'map' ? values.map : values.imagery)
  }
  apply()
  map.on('style.load', apply)
  background.onChange(apply)
}
