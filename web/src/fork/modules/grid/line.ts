// Fork: where a clicked power line goes. The backend (/grid/line/<osm_id>) follows
// the line through junctions (same voltage) up to the stations at its ends, so the
// whole line is highlighted and the details say which stations it connects.
import { LngLatBounds, Map } from 'maplibre-gl'
import type { MultiLineString } from 'geojson'
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { BACKEND_BASE_URL } from '../../config.ts'
import { FeatureHighlight } from '../../ui/highlight.ts'
import { Station } from './grid-route.ts'

type LineResponse = {
  stations: Station[]
  length_km: number
  voltages_kv: number[]
  complete: boolean
  geometry: MultiLineString
}

/**
 * Highlight the whole power line and return a short description for the
 * panel ("Connects A – B · 12.3 km"), or null if the backend can't be reached
 * or something else was selected meanwhile.
 */
export async function showLine(
  map: Map,
  highlight: FeatureHighlight,
  osmId: number
): Promise<HTMLElement | null> {
  const stillWanted = highlight.begin()
  let data: LineResponse
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/grid/line/${osmId}`)
    if (!response.ok) return null
    data = (await response.json()) as LineResponse
  } catch {
    return null
  }
  if (!stillWanted()) return null
  highlight.setData([{ type: 'Feature', geometry: data.geometry, properties: {} }])

  const names = data.stations.map(
    (s) =>
      s.name ||
      (s.kind === 'substation'
        ? t('route.unnamed-substation', 'Unnamed substation')
        : t('route.unnamed-plant', 'Unnamed power plant'))
  )
  const length = `${data.length_km.toLocaleString()} km`
  const text = names.length
    ? t('line.connects', 'Connects {{stations}} · {{length}}', { stations: names.join(' – '), length })
    : t('line.length', 'Highlighted: {{length}}', { length })
  const showAll = el('button.oim-line-show-all', t('line.show-all', 'Show whole line'), { type: 'button' })
  showAll.onclick = () => {
    const bounds = new LngLatBounds()
    for (const part of data.geometry.coordinates) {
      for (const coord of part) bounds.extend(coord as [number, number])
    }
    map.fitBounds(bounds, { padding: 80, maxZoom: 15 })
  }
  return el(
    'div.oim-line-connects',
    text,
    ...(data.complete ? [] : [el('span', ' ' + t('line.incomplete', '(very long, shown in part)'))]),
    ' ',
    showAll
  )
}
