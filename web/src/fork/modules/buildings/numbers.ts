// Fork: building numbers, a layer to switch on (Data layers → Background map →
// Building numbers): each building's number within its commune ("WIS-47"), the same
// for everyone sharing the map (web-backend building_numbers/: numbered the first
// time a commune is shown, a few seconds for a city, and kept). Asked for from zoom
// 16, for the view, each time the map stops moving.
import type { GeoJSONSource, Map } from 'maplibre-gl'
import { BUILDING_NUMBERS_URL } from '../../config.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { font, text_paint } from '../../../style/common.ts'
import { NUMBERS_FROM_ZOOM, NUMBERS_LAYER, NUMBERS_ZORDER } from './buildings.constants.ts'

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

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
        'text-field': ['get', 'label'],
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

/** Keeps the numbers of the view while the layer is on; a newer view's answer
 * replaces an older one still on its way (a city's first numbering takes seconds). */
export function followNumbers(map: Map) {
  let asking: AbortController | null = null
  // The view last asked for: the map's style changes often (highlights, looks), and
  // only a new view needs asking again.
  let asked = ''
  const refresh = async () => {
    const shown =
      map.getLayer(NUMBERS_LAYER) && map.getLayoutProperty(NUMBERS_LAYER, 'visibility') === 'visible'
    if (!shown || map.getZoom() < NUMBERS_FROM_ZOOM) return
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
      ;(map.getSource(NUMBERS_LAYER) as GeoJSONSource | undefined)?.setData(await response.json())
    } catch (error) {
      // A newer view asked meanwhile (aborted), or the backend is out of reach: the
      // numbers shown stay until the next move.
      if (!(error instanceof DOMException)) throw error
    }
  }
  map.on('moveend', () => void refresh())
  // Switched on: the view's numbers at once.
  map.on('styledata', () => void refresh())
}
