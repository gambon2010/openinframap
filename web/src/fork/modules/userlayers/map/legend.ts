// Fork: My layers on a printed map's legend (ui/legend.ts): the layers shown, with
// their colour, and the symbols and graphics in view, with their names.
import { LngLatBounds } from 'maplibre-gl'
import { t } from '../../../core/i18n.ts'
import type { LegendEntry, LegendSection } from '../../../ui/legend.ts'
import { DEFAULT_COLOR, UserFeature, UserLayer } from '../model/model.ts'
import { symbolName } from '../ui/palette.ts'
import { symbolSvg } from './symbols.ts'

/** Whether any of a feature's points is in view. */
export function inView(feature: UserFeature, bounds: Pick<LngLatBounds, 'contains'>): boolean {
  let found = false
  const visit = (c: unknown): void => {
    if (found || !Array.isArray(c)) return
    if (typeof c[0] === 'number') found = bounds.contains(c as [number, number])
    else c.forEach(visit)
  }
  visit((feature.geometry as GeoJSON.Point).coordinates)
  return found
}

/** The legend's sections for the layers shown (symbols drawn as SVG, async). */
export async function userLegend(
  layers: UserLayer[],
  bounds: Pick<LngLatBounds, 'contains'>
): Promise<LegendSection[]> {
  const shownLayers: LegendEntry[] = []
  const symbols = new globalThis.Map<string, LegendEntry | Promise<LegendEntry>>()
  for (const layer of layers) {
    const colour = layer.style.color ?? DEFAULT_COLOR
    const items = [...layer.features.values()].filter((f) => inView(f, bounds))
    if (!items.length) continue
    shownLayers.push({ label: layer.name, colour, shape: 'area' })
    for (const f of items) {
      const sidc = f.properties.sidc
      if (!sidc || symbols.has(sidc)) continue
      const label = symbolName(sidc) ?? sidc
      symbols.set(
        sidc,
        f.properties.kind === 'symbol'
          ? symbolSvg(sidc, 40).then((svg) => ({ label, svg }))
          : { label, colour, shape: 'line' }
      )
    }
  }
  const entries = (await Promise.all(symbols.values())).sort((a, b) => a.label.localeCompare(b.label))
  return [
    { title: t('userlayers.title', 'My layers'), entries: shownLayers, order: 20 },
    { title: t('userlayers.legend-symbols', 'Symbols'), entries, order: 21 }
  ]
}
