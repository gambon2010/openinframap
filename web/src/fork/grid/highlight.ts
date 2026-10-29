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
import { BACKEND_BASE_URL } from '../config.ts'
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
// An area smaller than this on screen is easier to see as its icon.
const MIN_AREA_PIXELS = 16

export default class FeatureHighlight {
  _map: Map
  _request = 0

  constructor(map: Map) {
    this._map = map
    const addLayers = () => {
      if (map.getSource(SOURCE)) return
      map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      // Above the whole background map (its labels come early in the stack, below
      // its water and roads), but below the first infrastructure label/icon, so
      // names and icons stay readable on top.
      const before = map
        .getStyle()
        .layers.find(
          (layer) => layer.type === 'symbol' && 'source' in layer && layer.source !== 'basemap'
        )?.id
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
          // Bigger than the plant/substation icons (~26 px), so the ring shows around them.
          paint: {
            'circle-radius': 22,
            'circle-color': YELLOW,
            'circle-opacity': 0.45,
            'circle-stroke-color': DARK_YELLOW,
            'circle-stroke-width': 3
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
    // Plants, substations and wind farms are drawn as an area and an icon.
    // Highlight the area when it's big enough to see, otherwise the icon.
    const drawn =
      osmId === undefined
        ? []
        : this._map
            .queryRenderedFeatures({ filter: ['==', ['get', 'osm_id'], osmId] })
            .filter((f) => f.source === feature.source)
    const area = feature.geometry.type.endsWith('Polygon')
      ? feature
      : drawn.find((f) => f.geometry.type.endsWith('Polygon'))
    if (area && this.screenSize(area) >= MIN_AREA_PIXELS) {
      this.setData(this.allPieces(area))
      return
    }
    const icon = feature.geometry.type === 'Point' ? feature : drawn.find((f) => f.geometry.type === 'Point')
    if (icon) {
      this.setData([{ type: 'Feature', geometry: icon.geometry, properties: {} }])
    } else if (area) {
      // A tiny area without an icon: a circle at its centre is easier to spot.
      const centre = this.bounds(area).getCenter()
      this.setData([
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [centre.lng, centre.lat] },
          properties: {}
        }
      ])
    } else {
      this.setData(this.allPieces(feature))
    }
  }

  /** A big area or long line is split over several tiles: collect all pieces. */
  allPieces(feature: MapGeoJSONFeature): Feature[] {
    const osmId = feature.properties['osm_id']
    if (osmId !== undefined && feature.source) {
      const pieces = this._map.querySourceFeatures(feature.source, {
        sourceLayer: feature.sourceLayer,
        filter: ['==', ['get', 'osm_id'], osmId]
      })
      if (pieces.length) {
        return pieces.map((piece) => ({ type: 'Feature', geometry: piece.geometry, properties: {} }))
      }
    }
    return [{ type: 'Feature', geometry: feature.geometry, properties: {} }]
  }

  bounds(feature: MapGeoJSONFeature): LngLatBounds {
    const bounds = new LngLatBounds()
    const add = (coords: unknown): void => {
      if (typeof (coords as number[])[0] === 'number') bounds.extend(coords as [number, number])
      else (coords as unknown[]).forEach(add)
    }
    if ('coordinates' in feature.geometry) add(feature.geometry.coordinates)
    return bounds
  }

  /**
   * Size on screen in pixels (larger of width and height) of the biggest single
   * part: a plant made of several small, far-apart parts is still small to see.
   */
  screenSize(feature: MapGeoJSONFeature): number {
    const geometry = feature.geometry
    const parts =
      geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : geometry.type === 'Polygon'
          ? [geometry.coordinates]
          : []
    let largest = 0
    for (const polygon of parts) {
      const bounds = new LngLatBounds()
      for (const coord of polygon[0]) bounds.extend(coord as [number, number])
      const a = this._map.project(bounds.getSouthWest())
      const b = this._map.project(bounds.getNorthEast())
      largest = Math.max(largest, Math.abs(a.x - b.x), Math.abs(a.y - b.y))
    }
    return largest
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

  /** Highlight a location (a search result that isn't a map feature). */
  showPoint(longitude: number, latitude: number) {
    this._request++
    this.setData([
      { type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties: {} }
    ])
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
