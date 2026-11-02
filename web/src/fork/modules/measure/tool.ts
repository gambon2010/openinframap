// Fork: measuring on the map: a distance along points (each leg's length and
// bearing, the total), an area (and its perimeter), range rings round a point.
// Measurements stay on the map until removed; they aren't saved (My layers is for
// that). While a tool is on, it has the map's clicks (ui/map-clicks.ts).
import { GeoJSONSource, Map, MapMouseEvent } from 'maplibre-gl'
import { font } from '../../../style/common.ts'
import { mapClicks } from '../../ui/map-clicks.ts'
import { North, fromNorth, northLetter } from './north.ts'
import { t } from '../../core/i18n.ts'
import {
  LngLat,
  area,
  bearing,
  circle,
  formatArea,
  formatBearing,
  formatDistance,
  pathLength
} from './geo.ts'

export type MeasureMode = 'distance' | 'area' | 'rings'

export interface Measurement {
  id: number
  kind: MeasureMode
  points: LngLat[]
  /** Range rings: their radii in metres. */
  radii?: number[]
}

const SOURCE = 'oim-measure'
const NORTH_KEY = 'oim-measure-north'

function rememberedNorth(): North {
  try {
    const value = localStorage.getItem(NORTH_KEY)
    return value === 'magnetic' || value === 'grid' ? value : 'true'
  } catch {
    return 'true'
  }
}
const COLOUR = '#d6336c'

/** A leg's bearing, from the north chosen ("047°M (836 mils)"). */
export function legBearing(a: LngLat, b: LngLat, north: North): string {
  return formatBearing(fromNorth(bearing(a, b), north, a[0], a[1]), northLetter(north))
}

/** What a measurement comes to, in words ("12.3 km", "3.2 ha, perimeter 1.1 km"). */
export function summary(m: Pick<Measurement, 'kind' | 'points' | 'radii'>, north: North = 'true'): string {
  if (m.kind === 'rings') return (m.radii ?? []).map(formatDistance).join(', ')
  if (m.kind === 'area') {
    const ring = [...m.points, m.points[0]]
    return t('measure.area-summary', '{{area}}, perimeter {{perimeter}}', {
      area: formatArea(area(m.points)),
      perimeter: formatDistance(pathLength(ring))
    })
  }
  const length = formatDistance(pathLength(m.points))
  if (m.points.length !== 2) return length
  return `${length}, ${legBearing(m.points[0], m.points[1], north)}`
}

const point = (coordinates: LngLat, properties: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties
})

const middle = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/** The features that draw a measurement (draft: the one being made, to the cursor). */
export function measurementFeatures(m: Measurement, draft = false, north: North = 'true'): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = []
  const props = { draft }
  if (m.kind === 'rings') {
    const centre = m.points[0]
    out.push(point(centre, { ...props, vertex: true }))
    for (const radius of m.radii ?? []) {
      const ring = circle(centre, radius)
      out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: props })
      // Labelled north, east, south and west (one is on screen even when it's big).
      for (let i = 0; i < 4; i++) {
        out.push(point(ring[(i * (ring.length - 1)) / 4], { ...props, label: formatDistance(radius) }))
      }
    }
    return out
  }
  for (const p of m.points) out.push(point(p, { ...props, vertex: true }))
  if (m.points.length < 2) return out
  if (m.kind === 'area') {
    const ring = [...m.points, m.points[0]]
    if (m.points.length >= 3) {
      out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: props })
      const centre: LngLat = [
        m.points.reduce((s, p) => s + p[0], 0) / m.points.length,
        m.points.reduce((s, p) => s + p[1], 0) / m.points.length
      ]
      out.push(point(centre, { ...props, label: formatArea(area(m.points)), big: true }))
    }
    out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: props })
    return out
  }
  out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: m.points }, properties: props })
  // Each leg: its length and bearing; the end: the total.
  for (let i = 1; i < m.points.length; i++) {
    const [a, b] = [m.points[i - 1], m.points[i]]
    out.push(
      point(middle(a, b), {
        ...props,
        label: `${formatDistance(pathLength([a, b]))}\n${legBearing(a, b, north)}`
      })
    )
  }
  if (m.points.length > 2) {
    out.push(
      point(m.points[m.points.length - 1], {
        ...props,
        label: formatDistance(pathLength(m.points)),
        big: true
      })
    )
  }
  return out
}

export class MeasureTool {
  mode: MeasureMode | null = null
  /** The points of the measurement being made. */
  points: LngLat[] = []
  cursor: LngLat | null = null
  done: Measurement[] = []
  /** Range rings' radii, metres. */
  radii = [1000, 5000, 10000]
  /** The north bearings are measured from (remembered in this browser). */
  north: North = rememberedNorth()
  private nextId = 1
  private listeners: (() => void)[] = []

  constructor(private map: Map) {
    map.on('click', (e) => this.click(e))
    map.on('dblclick', (e) => {
      if (this.mode !== 'distance' && this.mode !== 'area') return
      e.preventDefault()
      this.finish()
    })
    // Right-click: the measurement being made is dropped; none: the tool stops.
    map.on('contextmenu', (e) => {
      if (!this.mode) return
      e.preventDefault()
      e.originalEvent.preventDefault()
      this.cancel()
    })
    map.on('mousemove', (e) => {
      if (!this.mode || !this.points.length) return
      this.cursor = [e.lngLat.lng, e.lngLat.lat]
      this.draw()
      this.notify()
    })
    document.addEventListener('keydown', (e) => {
      if (!this.mode || (e.target as HTMLElement).closest?.('input, textarea')) return
      if (e.key === 'Escape') this.stop()
      else if (e.key === 'Enter') this.finish()
      else if (e.key === 'Backspace' && this.points.length) {
        this.points.pop()
        this.draw()
        this.notify()
      } else return
      e.preventDefault()
    })
    // A new style (another background map) drops what was added here.
    map.on('style.load', () => this.draw())
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  /** The measurement being made, to the cursor. */
  get draft(): Measurement | null {
    if (!this.mode || !this.points.length) return null
    const points = this.cursor && this.mode !== 'rings' ? [...this.points, this.cursor] : this.points
    return { id: 0, kind: this.mode, points, radii: this.radii }
  }

  /** Bearings from another north (the labels change at once). */
  setNorth(north: North) {
    this.north = north
    try {
      localStorage.setItem(NORTH_KEY, north)
    } catch {
      // Not remembered.
    }
    this.draw()
    this.notify()
  }

  /** Start a tool (the same again: stop it). */
  start(mode: MeasureMode) {
    const again = this.mode === mode
    this.stop()
    if (again) return
    this.mode = mode
    mapClicks.take('measure')
    this.map.doubleClickZoom.disable()
    this.map.getCanvas().style.cursor = 'crosshair'
    this.notify()
  }

  /** Stop the tool; what's being made is dropped. */
  stop() {
    if (!this.mode) return
    this.mode = null
    this.points = []
    this.cursor = null
    mapClicks.release('measure')
    this.map.doubleClickZoom.enable()
    this.map.getCanvas().style.cursor = ''
    this.draw()
    this.notify()
  }

  /** Drop the measurement being made (the tool stays on); nothing being made: stop. */
  cancel() {
    if (!this.points.length) return this.stop()
    this.points = []
    this.cursor = null
    this.draw()
    this.notify()
  }

  private click(e: MapMouseEvent) {
    if (!this.mode) return
    const p: LngLat = [e.lngLat.lng, e.lngLat.lat]
    if (this.mode === 'rings') {
      if (this.radii.length) this.keep({ kind: 'rings', points: [p], radii: [...this.radii] })
      return
    }
    // The two clicks of a double-click: one point.
    const last = this.points[this.points.length - 1]
    if (last) {
      const a = this.map.project(last)
      const b = this.map.project(p)
      if (Math.hypot(a.x - b.x, a.y - b.y) < 4) return
    }
    this.points.push(p)
    this.draw()
    this.notify()
  }

  /** The measurement being made is done (kept on the map); the tool stays on. */
  finish() {
    if (!this.mode || this.mode === 'rings') return
    if (this.points.length >= (this.mode === 'area' ? 3 : 2)) {
      this.keep({ kind: this.mode, points: this.points })
    }
    this.points = []
    this.cursor = null
    this.draw()
    this.notify()
  }

  private keep(m: Omit<Measurement, 'id'>) {
    this.done.push({ ...m, id: this.nextId++ })
    this.draw()
    this.notify()
  }

  remove(id: number) {
    this.done = this.done.filter((m) => m.id !== id)
    this.draw()
    this.notify()
  }

  clear() {
    this.done = []
    this.points = []
    this.draw()
    this.notify()
  }

  /** Draw everything again (adding the source and layers if the style lost them). */
  draw() {
    const map = this.map
    const draft = this.draft
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        ...this.done.flatMap((m) => measurementFeatures(m, false, this.north)),
        ...(draft ? measurementFeatures(draft, true, this.north) : [])
      ]
    }
    const source = map.getSource(SOURCE) as GeoJSONSource | undefined
    if (source) {
      source.setData(data)
      return
    }
    try {
      map.addSource(SOURCE, { type: 'geojson', data })
    } catch {
      // The style isn't ready yet.
      map.once('idle', () => this.draw())
      return
    }
    map.addLayer({
      id: 'oim-measure-fill',
      type: 'fill',
      source: SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': COLOUR, 'fill-opacity': 0.12 }
    })
    // What's being made: dashed.
    for (const draft of [false, true]) {
      map.addLayer({
        id: `oim-measure-line${draft ? '-draft' : ''}`,
        type: 'line',
        source: SOURCE,
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'draft'], draft]],
        paint: { 'line-color': COLOUR, 'line-width': 2.5, ...(draft ? { 'line-dasharray': [2, 2] } : {}) }
      })
    }
    map.addLayer({
      id: 'oim-measure-vertex',
      type: 'circle',
      source: SOURCE,
      filter: ['==', ['get', 'vertex'], true],
      paint: {
        'circle-radius': 4,
        'circle-color': '#fff',
        'circle-stroke-color': COLOUR,
        'circle-stroke-width': 2
      }
    })
    map.addLayer({
      id: 'oim-measure-label',
      type: 'symbol',
      source: SOURCE,
      filter: ['has', 'label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': font,
        'text-size': ['case', ['get', 'big'], 14, 12],
        'text-offset': [0, -1.1],
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 2 }
    })
  }
}
