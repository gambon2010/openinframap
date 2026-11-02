// Fork: a measurement (a My layers item of the kind "measure", kinds/measure.ts):
// what it comes to and how it's drawn, as GeoJSON with labels: each leg's length and
// bearing and the total, with marks along the way (ticks.ts); an area and its
// perimeter; range rings and their radii. Lines follow great circles, the paths the
// distances are measured along. Pure; map/render.ts draws them.
import { t } from '../../../core/i18n.ts'
import { FeatureProps } from '../model/model.ts'
import { North, fromNorth, northLetter } from './north.ts'
import { TickView, ticksAlong } from './ticks.ts'
import {
  LngLat,
  area,
  bearing,
  circle,
  formatArea,
  formatBearing,
  formatDistance,
  greatCirclePath,
  pathLength
} from './geo.ts'

export type MeasureType = 'distance' | 'area' | 'rings'

export interface Measurement {
  type: MeasureType
  points: LngLat[]
  /** Range rings: their radii in metres. */
  radii?: number[]
}

/** Range rings' radii when none are set (metres). */
export const DEFAULT_RADII = [1000, 5000, 10000]

/** A measure item's measurement, from its geometry (null: not one). */
export function measurementOf(item: {
  geometry: GeoJSON.Geometry
  properties: FeatureProps
}): Measurement | null {
  const p = item.properties
  const g = item.geometry
  if (p.measure === 'rings' && g.type === 'Point')
    return { type: 'rings', points: [g.coordinates as LngLat], radii: (p.radii as number[]) ?? DEFAULT_RADII }
  if (p.measure === 'area' && g.type === 'Polygon')
    return { type: 'area', points: g.coordinates[0].slice(0, -1) as LngLat[] }
  if (g.type === 'LineString') return { type: 'distance', points: g.coordinates as LngLat[] }
  return null
}

/** A leg's bearing, from the north chosen ("047°M (836 mils)"). */
export function legBearing(a: LngLat, b: LngLat, north: North): string {
  return formatBearing(fromNorth(bearing(a, b), north, a[0], a[1]), northLetter(north))
}

/** What a measurement comes to, in words ("12.3 km", "3.2 ha, perimeter 1.1 km"). */
export function summary(m: Measurement, north: North = 'true'): string {
  if (m.type === 'rings') return (m.radii ?? []).map(formatDistance).join(', ')
  if (m.type === 'area') {
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

export interface DrawOptions {
  /** The one being drawn (to the cursor): dashed. */
  draft?: boolean
  north?: North
  /** Where marks go along distances (none: no marks). */
  ticks?: TickView
  /** Copied onto every feature (the item's id, its colour). */
  properties?: Record<string, unknown>
}

/** The features that draw a measurement. */
export function measurementFeatures(m: Measurement, options: DrawOptions = {}): GeoJSON.Feature[] {
  const north = options.north ?? 'true'
  const props = { ...(options.properties ?? {}), draft: Boolean(options.draft) }
  const line = (coordinates: LngLat[]): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: props
  })
  const out: GeoJSON.Feature[] = []
  if (m.type === 'rings') {
    const centre = m.points[0]
    out.push(point(centre, { ...props, vertex: true }))
    for (const radius of m.radii ?? []) {
      const ring = circle(centre, radius)
      out.push(line(ring))
      // Labelled north, east, south and west (one is on screen even when it's big).
      for (let i = 0; i < 4; i++) {
        out.push(point(ring[(i * (ring.length - 1)) / 4], { ...props, label: formatDistance(radius) }))
      }
    }
    return out
  }
  if (options.draft) for (const p of m.points) out.push(point(p, { ...props, vertex: true }))
  if (m.points.length < 2) return out
  if (m.type === 'area') {
    const ring = greatCirclePath([...m.points, m.points[0]])
    if (m.points.length >= 3) {
      out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: props })
      const centre: LngLat = [
        m.points.reduce((s, p) => s + p[0], 0) / m.points.length,
        m.points.reduce((s, p) => s + p[1], 0) / m.points.length
      ]
      out.push(point(centre, { ...props, label: formatArea(area(m.points)), big: true }))
    }
    out.push(line(ring))
    return out
  }
  out.push(line(greatCirclePath(m.points)))
  if (options.ticks) out.push(...ticksAlong(m.points, options.ticks, props))
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
