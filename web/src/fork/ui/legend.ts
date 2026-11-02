// Fork: the legend of a printed map (modules/print): each module says what of its
// own is on the map now (My layers' layers and symbols, the power supply colours...).
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

type Source = (map: Map) => LegendSection[] | Promise<LegendSection[]>

const sources: Source[] = []

/** Say what goes in the legend (asked each time a map is printed). */
export function addLegend(source: Source) {
  sources.push(source)
}

/** The legend now: the sections with entries, in order. */
export async function legendSections(map: Map): Promise<LegendSection[]> {
  const settled = await Promise.allSettled(sources.map(async (source) => source(map)))
  return settled
    .flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
    .filter((s) => s.entries.length)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}
