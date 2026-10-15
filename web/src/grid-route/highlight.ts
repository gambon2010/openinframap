/*
 * Fork: highlight the feature whose details are shown in the side panel.
 *
 * Any clicked feature is highlighted: points with a glowing circle, areas with
 * an outline and a light fill, lines along their length. For power lines the
 * backend (/grid/line/<osm_id>) also follows the line through junctions (same
 * voltage) up to the stations at its ends, so the whole line is highlighted and
 * the panel can say which stations it connects.
 */
import { Map, GeoJSONSource, LngLatBounds, MapGeoJSONFeature, FilterSpecification } from 'maplibre-gl'
import type { Feature, MultiLineString } from 'geojson'
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

const SOURCE = 'feature_highlight'
const YELLOW = '#ffd400'
const DARK_YELLOW = '#b88a00'

export default class FeatureHighlight {
  _map: Map
  _request = 0

  constructor(map: Map) {
    this._map = map
    const addLayers = () => {
      if (map.getSource(SOURCE)) return
      map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      // Below the first label/icon layer, so names and icons stay readable on top.
      const before = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
      const polygon: FilterSpecification = ['==', ['geometry-type'], 'Polygon']
      map.addLayer(
        {
          id: 'feature_highlight_fill',
          type: 'fill',
          source: SOURCE,
          filter: polygon,
          paint: { 'fill-color': YELLOW, 'fill-opacity': 0.25 }
        },
        before
      )
      map.addLayer(
        {
          id: 'feature_highlight_glow',
          type: 'line',
          source: SOURCE,
          filter: ['!=', ['geometry-type'], 'Point'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': YELLOW, 'line-width': 12, 'line-blur': 3, 'line-opacity': 0.75 }
        },
        before
      )
      map.addLayer(
        {
          id: 'feature_highlight_line',
          type: 'line',
          source: SOURCE,
          filter: ['!=', ['geometry-type'], 'Point'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': DARK_YELLOW, 'line-width': 2 }
        },
        before
      )
      map.addLayer(
        {
          id: 'feature_highlight_point',
          type: 'circle',
          source: SOURCE,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 16,
            'circle-color': YELLOW,
            'circle-opacity': 0.5,
            'circle-blur': 0.3,
            'circle-stroke-color': DARK_YELLOW,
            'circle-stroke-width': 2
          }
        },
        before
      )
    }
    if (map.isStyleLoaded()) addLayers()
    else map.once('load', addLayers)
  }

  /** Highlight a clicked feature right away, from the map's own tiles. */
  showFeature(feature: MapGeoJSONFeature) {
    this._request++
    const osmId = feature.properties['osm_id']
    let parts: Feature[] = [{ type: 'Feature', geometry: feature.geometry, properties: {} }]
    if (osmId !== undefined && feature.source) {
      // A big area or long line is split over several tiles: collect all pieces.
      const pieces = this._map.querySourceFeatures(feature.source, {
        sourceLayer: feature.sourceLayer,
        filter: ['==', ['get', 'osm_id'], osmId]
      })
      if (pieces.length) {
        parts = pieces.map((piece) => ({ type: 'Feature', geometry: piece.geometry, properties: {} }))
      }
    }
    this.setData(parts)
  }

  /**
   * Highlight the whole power line and return a short description for the
   * panel ("Connects A – B · 12.3 km"), or null if the backend can't be reached.
   */
  async showLine(osmId: number): Promise<HTMLElement | null> {
    const request = ++this._request
    let data: LineResponse
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/grid/line/${osmId}`)
      if (!response.ok) return null
      data = (await response.json()) as LineResponse
    } catch {
      return null
    }
    if (request !== this._request) return null // something else was selected meanwhile
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

  setData(features: Feature[]) {
    const source = this._map.getSource(SOURCE) as GeoJSONSource | undefined
    source?.setData({ type: 'FeatureCollection', features })
  }
}
