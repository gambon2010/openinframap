// Fork: building numbers, a layer to switch on (Data layers → Background map →
// Building numbers): each building's number within its neighbourhood, or its commune
// when it has none ("STR-NEU-12", "WIS-47"), the same for everyone sharing the map
// (web-backend building_numbers/: numbered the first time an area is shown, a few
// seconds, and kept). Written whole or as the number alone (Settings: more fit).
// Asked for from zoom 16, for the view, each time the map stops moving. The same
// answer lists the view's slivers (a staircase's steps drawn as buildings): left out
// of the buildings outside 3D, while Buildings is on.
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map } from 'maplibre-gl'
import { el } from 'redom'
import { BUILDING_NUMBERS_URL } from '../../config.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { font, text_paint } from '../../../style/common.ts'
import { BUILDINGS_LAYER } from '../../core/buildings.ts'
import { t } from '../../core/i18n.ts'
import { readText, writeText } from '../../core/storage.ts'
import { addSettingsSection } from '../../ui/settings.ts'
import {
  NUMBERS_FROM_ZOOM,
  NUMBERS_LABELS_KEY,
  NUMBERS_LAYER,
  NUMBERS_ZORDER
} from './buildings.constants.ts'

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** The buildings' layers drawn outside 3D (their outline, click area and shadow): the
 * slivers are left out of these. */
const FLAT_LAYERS = [BUILDINGS_LAYER, `${BUILDINGS_LAYER}_hit`, `${BUILDINGS_LAYER}_shadow`]

type LabelStyle = 'full' | 'number'

export function numbersSource() {
  return { [NUMBERS_LAYER]: { type: 'geojson' as const, data: EMPTY } }
}

export function numbersLayers(): LayerSpecificationWithZIndex[] {
  return [
    {
      id: NUMBERS_LAYER,
      type: 'symbol',
      source: NUMBERS_LAYER,
      minzoom: NUMBERS_FROM_ZOOM,
      zorder: NUMBERS_ZORDER,
      layout: {
        'text-field': labelOf(labelStyle()),
        'text-font': font,
        'text-size': 11,
        // Where two would overlap (small buildings side by side), one waits for a
        // closer zoom rather than both being unreadable.
        'text-padding': 1,
        visibility: 'none'
      },
      paint: text_paint
    }
  ]
}

/** Keeps the numbers and slivers of the view while numbers or buildings are on; a
 * newer view's answer replaces an older one still on its way (a city's first
 * numbering takes seconds). */
export function followNumbers(map: Map) {
  addLabelSetting(map)
  const original = new globalThis.Map<string, FilterSpecification | undefined>()
  const hidden = new Set<number>()
  let asking: AbortController | null = null
  // The view last asked for: the map's style changes often (highlights, looks), and
  // only a new view needs asking again.
  let asked = ''
  const refresh = async () => {
    if (!(shown(map, NUMBERS_LAYER) || shown(map, BUILDINGS_LAYER)) || map.getZoom() < NUMBERS_FROM_ZOOM)
      return
    const b = map.getBounds()
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(5)).join(',')
    if (bbox === asked) return
    asked = bbox
    asking?.abort()
    asking = new AbortController()
    try {
      const response = await fetch(`${BUILDING_NUMBERS_URL}?bbox=${bbox}`, { signal: asking.signal })
      if (!response.ok) {
        asked = '' // asked again next time (not numbered: too far out, or no outlines yet)
        return
      }
      const answer = (await response.json()) as GeoJSON.FeatureCollection & { hidden: number[] }
      ;(map.getSource(NUMBERS_LAYER) as GeoJSONSource | undefined)?.setData(answer)
      // Kept from view to view, so a sliver doesn't flash back while moving.
      for (const id of answer.hidden) hidden.add(id)
      leaveOut(map, hidden, original)
    } catch (error) {
      // A newer view asked meanwhile (aborted), or the backend is out of reach: what's
      // shown stays until the next move.
      if (!(error instanceof DOMException)) throw error
    }
  }
  map.on('moveend', () => void refresh())
  // Switched on: the view's at once.
  map.on('styledata', () => void refresh())
}

function shown(map: Map, layer: string): boolean {
  return Boolean(map.getLayer(layer)) && map.getLayoutProperty(layer, 'visibility') === 'visible'
}

/** The slivers left out of the flat buildings' layers (their own filters kept). */
function leaveOut(
  map: Map,
  hidden: Set<number>,
  original: globalThis.Map<string, FilterSpecification | undefined>
) {
  const notSliver: FilterSpecification = ['!', ['in', ['id'], ['literal', [...hidden]]]]
  for (const id of FLAT_LAYERS) {
    if (!map.getLayer(id)) continue
    if (!original.has(id)) original.set(id, map.getFilter(id) as FilterSpecification | undefined)
    const own = original.get(id)
    const kept = own ? (['all', own, notSliver] as FilterSpecification) : notSliver
    map.setFilter(id, kept)
  }
}

/** The label: "STR-NEU-12", or "12" (more of them fit). */
function labelOf(style: LabelStyle): ExpressionSpecification {
  const number: ExpressionSpecification = ['to-string', ['get', 'number']]
  return style === 'number' ? number : ['concat', ['get', 'prefix'], '-', number]
}

function labelStyle(): LabelStyle {
  return readText(NUMBERS_LABELS_KEY) === 'number' ? 'number' : 'full'
}

/** Settings → Building numbers: written whole or as the number alone (this browser). */
function addLabelSetting(map: Map) {
  const choice = el(
    'select',
    el('option', t('buildings.numbers-full', 'With their place (STR-NEU-12)'), { value: 'full' }),
    el('option', t('buildings.numbers-short', 'The number only (12)'), { value: 'number' })
  ) as HTMLSelectElement
  choice.value = labelStyle()
  choice.onchange = () => {
    writeText(NUMBERS_LABELS_KEY, choice.value)
    if (map.getLayer(NUMBERS_LAYER)) map.setLayoutProperty(NUMBERS_LAYER, 'text-field', labelOf(labelStyle()))
  }
  addSettingsSection({
    el: el(
      'section',
      el('h3', t('buildings.numbers-title', 'Building numbers')),
      el('label', t('buildings.numbers-labels', 'Written'), ' ', choice)
    ),
    refresh: () => (choice.value = labelStyle())
  })
}
