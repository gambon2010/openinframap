// Fork: what a measurement comes to and how it's drawn, as GeoJSON with labels
// (each leg's length and bearing, the total; an area and its perimeter; rings and
// their radii). Pure: tool.ts keeps the measurements, layers.ts draws them.
import { t } from '../../core/i18n.ts'
import { North, fromNorth, northLetter } from './north.ts'
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
