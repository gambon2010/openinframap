// Fork: My layers on a printed map's legend (ui/legend.ts): each layer shown, by its
// name, with what of it is in the printed area (each kind once, with its picture).
import { LngLatBounds } from 'maplibre-gl'
import type { LegendEntry, LegendSection } from '../../../services/legend.ts'
import { DEFAULT_COLOR, UserFeature, UserLayer } from '../model/model.ts'
import { symbolName } from '../ui/palette.ts'
import { symbolSvg } from './symbols.ts'
import { kindOf } from '../kinds/index.ts'
import { graphicSvg } from '../graphics/svg.ts'
import { graphicName } from '../graphics/labels.ts'
import { positionsOf } from '../model/shapes.ts'

/** Whether any of a feature's points is in view. */
export function inView(feature: UserFeature, bounds: Pick<LngLatBounds, 'contains'>): boolean {
  return positionsOf(feature.geometry).some((position) => bounds.contains(position))
}

/** What an item puts in the legend: its name and picture (one per kind in a layer). */
async function entryOf(f: UserFeature): Promise<LegendEntry | null> {
  const p = f.properties
  const kind = kindOf(p)
  const colour = p.color ?? DEFAULT_COLOR
  if (p.sidc) {
    const label = symbolName(p.sidc) ?? p.sidc
    if (kind.drawn === 'graphic') {
      // In its own colour, else the renderer's (as on the map), black by default;
      // its label first ("WUP: Withdraw under pressure"), in the chosen language.
      const drawn = await graphicSvg(p.sidc, p.color)
      const name = graphicName(p.sidc, label)
      const written = drawn?.labels.join(' ')
      const text = written && written !== name ? `${written}: ${name}` : name
      return drawn ? { label: text, svg: drawn.svg } : { label: text, colour, shape: 'line' }
    }
    if (kind.military) return { label, svg: await symbolSvg(p.sidc, 40) }
  }
  // Lines, areas and markers: in their colour, by name (or what they are).
  if (kind.id === 'drawing' || kind.id === 'marker') {
    const shape = kind.id === 'marker' ? 'dot' : f.geometry.type.endsWith('Polygon') ? 'area' : 'line'
    return { label: p.name?.trim() || kind.what(f), colour, shape }
  }
  // Copies are explained by the map's key, pictures and measurements by themselves.
  return null
}

/**
 * The legend's sections: one per layer shown with something in the printed area,
 * titled with its name, listing what's there (each kind once) with its picture: a
 * unit's symbol, a graphic drawn small, a line or area in its colour.
 */
export async function userLegend(
  layers: UserLayer[],
  bounds: Pick<LngLatBounds, 'contains'>
): Promise<LegendSection[]> {
  const sections: LegendSection[] = []
  for (const [i, layer] of layers.entries()) {
    const entries = new globalThis.Map<string, LegendEntry>()
    for (const f of layer.features.values()) {
      if (!inView(f, bounds)) continue
      const entry = await entryOf(f)
      if (!entry) continue
      const key = `${entry.label}\n${entry.svg ?? ''}\n${entry.colour ?? ''}\n${entry.shape ?? ''}`
      if (!entries.has(key)) entries.set(key, entry)
    }
    if (!entries.size) continue
    sections.push({
      title: layer.name,
      entries: [...entries.values()].sort((a, b) => a.label.localeCompare(b.label)),
      order: 20 + i / 1000
    })
  }
  return sections
}
