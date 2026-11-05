// Fork: the legend of a printed map (modules/print): each module says what of its
// own is in the printed part of the map (the key's rows of what's there: ui/key/
// legend.ts; My layers' items by layer; the power supply colours...).
import type { Map } from 'maplibre-gl'

export interface LegendEntry {
  label: string
  /** A swatch of this colour, drawn as a line, an area or a dot. */
  colour?: string
  shape?: 'line' | 'area' | 'dot'
  /** Or a picture (a symbol), as SVG. */
  svg?: string
}

export interface LegendSection {
  title: string
  entries: LegendEntry[]
  /** Where it goes: lower first (default 0). */
  order?: number
}

/** The part of the map printed, in CSS pixels on the map's canvas. */
export interface LegendArea {
  x: number
  y: number
  w: number
  h: number
}

/** A legend's source: what of its own is in `area` (the whole map if none). */
type Source = (map: Map, area: LegendArea) => LegendSection[] | Promise<LegendSection[]>

const sources: Source[] = []

/** Say what goes in the legend (asked each time a map is printed). */
export function addLegend(source: Source) {
  sources.push(source)
}

/** The legend now, for what's in `area` (default: the whole map): the sections with
 * entries, in order. */
export async function legendSections(map: Map, area?: LegendArea): Promise<LegendSection[]> {
  const canvas = map.getCanvas()
  const where = area ?? { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight }
  const settled = await Promise.allSettled(sources.map(async (source) => source(map, where)))
  return settled
    .flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
    .filter((s) => s.entries.length)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}
