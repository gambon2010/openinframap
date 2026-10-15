/*
 * Fork (prototype): highlight where a power line goes.
 *
 * When a power line's popup opens, the backend (/grid/line/<osm_id>) follows the
 * line through junctions (same voltage) up to the stations at its ends; the whole
 * stretch is highlighted until the popup closes, and the popup says which
 * stations it connects.
 */
import { Map, GeoJSONSource, LngLatBounds } from 'maplibre-gl'
import type { MultiLineString } from 'geojson'
import { t } from 'i18next'
import { el } from 'redom'
import { BACKEND_BASE_URL } from '../config.js'
import { Station } from './grid-route.ts'

type LineResponse = {
  stations: Station[]
  length_km: number
  voltages_kv: number[]
  complete: boolean
  geometry: MultiLineString
}

const SOURCE = 'line_highlight'

export default class LineHighlight {
  _map: Map
  _request = 0

  constructor(map: Map) {
    this._map = map
    const addLayers = () => {
      if (map.getSource(SOURCE)) return
      map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'line_highlight_glow',
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffd400', 'line-width': 12, 'line-blur': 3, 'line-opacity': 0.75 }
      })
      map.addLayer({
        id: 'line_highlight',
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#b88a00', 'line-width': 2 }
      })
    }
    if (map.isStyleLoaded()) addLayers()
    else map.once('load', addLayers)
  }

  /**
   * Highlight the line and return a short description for its popup
   * ("Connects A – B · 12.3 km"), or null if the backend can't be reached.
   */
  async show(osmId: number): Promise<HTMLElement | null> {
    const request = ++this._request
    let data: LineResponse
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/grid/line/${osmId}`)
      if (!response.ok) return null
      data = (await response.json()) as LineResponse
    } catch {
      return null
    }
    if (request !== this._request) return null // another line was clicked meanwhile
    this.setData([{ type: 'Feature', geometry: data.geometry, properties: {} }])

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
      this._map.fitBounds(bounds, { padding: 80, maxZoom: 15 })
    }
    return el(
      'div.oim-line-connects',
      text,
      ...(data.complete ? [] : [el('span', ' ' + t('line.incomplete', '(very long, shown in part)'))]),
      ' ',
      showAll
    )
  }

  clear() {
    this._request++
    this.setData([])
  }

  setData(features: GeoJSON.Feature[]) {
    const source = this._map.getSource(SOURCE) as GeoJSONSource | undefined
    source?.setData({ type: 'FeatureCollection', features })
  }
}
