/*
 * Fork (prototype): show how two stations are connected through the grid.
 *
 * Substation and power plant popups get "Route from here" / "Route to here"
 * buttons. With both ends set, the backend (/grid/route) returns up to three
 * distinct paths over lines of 110 kV and more, which are drawn in different
 * colours and listed in a panel. The selection is kept in the URL hash
 * (route=s123_p-456), so a view can be shared.
 */
import { IControl, Map, GeoJSONSource, LngLatBounds } from 'maplibre-gl'
import type { Feature, MultiLineString } from 'geojson'
import { URLHash } from '@russss/maplibregl-layer-switcher'
import { t } from 'i18next'
import { el, mount, setChildren } from 'redom'
import { BACKEND_BASE_URL } from '../config.js'
import './grid-route.css'

export type StationKind = 'substation' | 'plant'

export type Station = {
  kind: StationKind
  osm_id: number
  name?: string | null
}

type RoutePath = {
  length_km: number
  voltages_kv: number[]
  stations: Station[]
  geometry: MultiLineString
}

// A station not on the ≥110 kV grid is first connected to it over lower
// voltages (e.g. a wind farm's 65 kV line to the nearest 220 kV substation).
type AccessLeg = RoutePath & { end: 'from' | 'to' }

// What's drawn and listed: a whole route (connection legs included).
type Route = RoutePath & { lower: string[] }

type RouteResponse = {
  from: Station
  to: Station
  notices: string[]
  access: AccessLeg[]
  paths: RoutePath[]
}

const SOURCE = 'grid_route'
export const PATH_COLOURS = ['#e6007e', '#0072ce', '#ff8c00', '#2e9e44', '#8e44ad']

// Hash format: s<osm_id> for substations, p<osm_id> for plants, joined by "_".
function encodeStation(s: Station): string {
  return (s.kind === 'substation' ? 's' : 'p') + s.osm_id
}

function decodeStation(value: string): Station | null {
  const match = /^([sp])(-?\d+)$/.exec(value)
  if (!match) return null
  return { kind: match[1] === 's' ? 'substation' : 'plant', osm_id: parseInt(match[2]) }
}

function stationLabel(s: Station): string {
  return (
    s.name ||
    (s.kind === 'substation'
      ? t('route.unnamed-substation', 'Unnamed substation')
      : t('route.unnamed-plant', 'Unnamed power plant'))
  )
}

/**
 * One route per path, with the connection legs (stations only on lower
 * voltages, e.g. a wind farm on a 65 kV line) joined on, so each route is one
 * continuous line. A note says how much of it runs below 110 kV.
 */
function combineRoutes(data: RouteResponse): Route[] {
  const legs = data.access || []
  const from = legs.find((leg) => leg.end === 'from')
  const to = legs.find((leg) => leg.end === 'to')
  const lower = legs.map((leg) => {
    const first = leg.stations[0]
    const last = leg.stations[leg.stations.length - 1]
    return t('route.lower', 'incl. {{km}} km at {{kv}} kV from {{from}} to {{to}}', {
      km: leg.length_km.toLocaleString(),
      kv: leg.voltages_kv.join('/'),
      from: first ? stationLabel(first) : '?',
      to: last ? stationLabel(last) : '?'
    })
  })
  // Both ends reach the ≥110 kV grid at the same station: the legs are the whole route.
  const paths: RoutePath[] = data.paths.length
    ? data.paths
    : legs.length
      ? [
          {
            length_km: 0,
            voltages_kv: [],
            stations: [],
            geometry: { type: 'MultiLineString', coordinates: [] }
          }
        ]
      : []
  return paths.map((path) => {
    const parts = [from, path, to].filter((p): p is RoutePath => Boolean(p))
    const stations: Station[] = []
    for (const part of parts) {
      for (const s of part.stations) {
        const prev = stations[stations.length - 1]
        if (!prev || prev.kind !== s.kind || prev.osm_id !== s.osm_id) stations.push(s)
      }
    }
    return {
      length_km: Math.round(parts.reduce((sum, p) => sum + p.length_km, 0) * 10) / 10,
      voltages_kv: [...new Set(parts.flatMap((p) => p.voltages_kv))].sort((a, b) => b - a),
      stations,
      geometry: { type: 'MultiLineString', coordinates: parts.flatMap((p) => p.geometry.coordinates) },
      lower
    }
  })
}

export default class GridRouteControl implements IControl {
  _map?: Map
  _urlHash: URLHash
  _container!: HTMLDivElement
  _body!: HTMLDivElement
  _from?: Station
  _to?: Station
  _paths: Route[] = []
  _selected: number | null = null
  _request = 0

  constructor(urlHash: URLHash) {
    this._urlHash = urlHash
    urlHash.registerHandler('route', (value) => this.fromHash(value))
  }

  onAdd(map: Map) {
    this._map = map
    this._body = el('div', { class: 'oim-route-body' })
    const close = el('button', '×', {
      class: 'oim-route-close',
      type: 'button',
      title: t('route.clear', 'Clear'),
      'aria-label': t('route.clear', 'Clear')
    })
    close.onclick = () => this.clear()
    this._container = el(
      'div',
      { class: 'maplibregl-ctrl oim-route-panel' },
      el('div', { class: 'oim-route-header' }, el('h2', t('route.title', 'Grid connection')), close),
      this._body
    ) as HTMLDivElement

    const addLayers = () => {
      if (map.getSource(SOURCE)) return
      map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'grid_route_casing',
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 9,
          'line-offset': ['get', 'offset'],
          'line-opacity': ['get', 'opacity']
        }
      })
      map.addLayer({
        id: 'grid_route',
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'colour'],
          'line-width': 5,
          'line-offset': ['get', 'offset'],
          'line-opacity': ['get', 'opacity']
        }
      })
      this.draw()
    }
    if (map.isStyleLoaded()) addLayers()
    else map.once('load', addLayers)

    this.render()
    return this._container
  }

  onRemove() {
    this._container.remove()
    this._map = undefined
  }

  /** Called from the info popup's buttons. */
  setEnd(end: 'from' | 'to', station: Station) {
    if (end === 'from') this._from = station
    else this._to = station
    this.update()
  }

  clear() {
    this._from = undefined
    this._to = undefined
    this.update()
  }

  fromHash(value: string | null) {
    const [from, to] = (value || '').split('_').map(decodeStation)
    const same = (a?: Station, b?: Station | null) => a?.kind === b?.kind && a?.osm_id === b?.osm_id
    if (same(this._from, from) && same(this._to, to)) return
    this._from = from || undefined
    this._to = to || undefined
    this.update(false)
  }

  async update(writeHash = true) {
    if (writeHash) {
      const parts = [this._from, this._to].map((s) => (s ? encodeStation(s) : ''))
      this._urlHash.setParameter('route', this._from || this._to ? parts.join('_') : null)
    }
    this._paths = []
    this._selected = null
    this.draw()
    if (!this._from || !this._to) {
      this.render()
      return
    }

    const request = ++this._request
    this.render(t('route.searching', 'Looking for connections over lines of 110 kV or more…'))
    const params = new URLSearchParams({
      from: `${this._from.kind}/${this._from.osm_id}`,
      to: `${this._to.kind}/${this._to.osm_id}`,
      paths: '3'
    })
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/grid/route?${params.toString()}`)
      if (request !== this._request) return // a newer selection replaced this one
      if (!response.ok) {
        this.render(await response.text(), true)
        return
      }
      const data = (await response.json()) as RouteResponse
      this._from = { ...this._from, name: data.from.name }
      this._to = { ...this._to, name: data.to.name }
      this._paths = combineRoutes(data)
      this.draw()
      this.render(undefined, false, data.notices)
      this.zoom()
    } catch {
      if (request === this._request) {
        this.render(t('route.error', "Couldn't reach the backend to find connections."), true)
      }
    }
  }

  /** Paths as map features; shared stretches are offset so each colour stays visible. */
  draw() {
    const source = this._map?.getSource(SOURCE) as GeoJSONSource | undefined
    if (!source) return
    const count = this._paths.length
    const features: Feature[] = this._paths
      .map((path, i) => ({
        type: 'Feature' as const,
        geometry: path.geometry,
        properties: {
          colour: PATH_COLOURS[i % PATH_COLOURS.length],
          offset: (i - (count - 1) / 2) * 5,
          opacity: this._selected === null || this._selected === i ? 1 : 0.2
        }
      }))
      .reverse() // first path on top
    source.setData({ type: 'FeatureCollection', features })
  }

  zoom(index?: number) {
    if (!this._map || !this._paths.length) return
    const bounds = new LngLatBounds()
    const paths = index === undefined ? this._paths : [this._paths[index]]
    for (const path of paths) {
      for (const line of path.geometry.coordinates) {
        for (const coord of line) bounds.extend(coord as [number, number])
      }
    }
    this._map.fitBounds(bounds, { padding: 60, maxZoom: 13 })
  }

  select(index: number) {
    this._selected = this._selected === index ? null : index
    this.draw()
    this.render()
    if (this._selected !== null) this.zoom(index)
  }

  render(message?: string, isError = false, notices: string[] = []) {
    if (!this._container) return
    this._container.classList.toggle('visible', Boolean(this._from || this._to))

    const end = (label: string, station: Station | undefined, which: 'from' | 'to') =>
      el(
        'div',
        { class: 'oim-route-end' },
        el('span', { class: 'oim-route-end-label' }, label),
        station
          ? el('span', stationLabel(station))
          : el(
              'span',
              { class: 'oim-route-hint' },
              t('route.pick', 'Click a substation or power plant and choose "{{end}}"', {
                end:
                  which === 'from'
                    ? t('route.from-here', 'Route from here')
                    : t('route.to-here', 'Route to here')
              })
            )
      )

    const children: HTMLElement[] = [
      end(t('route.from', 'From'), this._from, 'from'),
      end(t('route.to', 'To'), this._to, 'to')
    ]
    for (const notice of notices) children.push(el('p', { class: 'oim-route-notice' }, notice))
    if (message) children.push(el('p', { class: isError ? 'oim-route-error' : 'oim-route-status' }, message))

    if (this._paths.length) {
      const list = el('ol', { class: 'oim-route-paths' })
      this._paths.forEach((path, i) => {
        const via = path.stations.slice(1, -1).map(stationLabel)
        const item = el(
          'li',
          {
            class: 'oim-route-path' + (this._selected === i ? ' selected' : ''),
            title: t('route.select', 'Show only this path')
          },
          el('span', {
            class: 'oim-route-swatch',
            style: `background: ${PATH_COLOURS[i % PATH_COLOURS.length]}`
          }),
          el(
            'div',
            el('strong', `${path.length_km.toLocaleString()} km`),
            ' · ',
            path.voltages_kv.map((v) => `${v} kV`).join(', '),
            ...(via.length
              ? [el('div', { class: 'oim-route-via' }, t('route.via', 'via') + ' ' + via.join(', '))]
              : []),
            ...path.lower.map((note) => el('div', { class: 'oim-route-via' }, note))
          )
        )
        item.onclick = () => this.select(i)
        mount(list, item)
      })
      children.push(list)
      children.push(
        el(
          'p',
          { class: 'oim-route-note' },
          t('route.note', 'Physical connections in OpenStreetMap, not how power actually flows.')
        )
      )
    }
    setChildren(this._body, children)
  }
}
