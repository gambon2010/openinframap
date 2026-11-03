// Fork: a measurement (a My layers item of the kind "measure", kinds/measure.ts):
// what it comes to and how it's drawn, as GeoJSON with labels: each leg's length and
// bearing and the total, with marks along the way (ticks.ts); an area and its
// perimeter; range rings and their radii. Lines follow great circles, the paths the
// distances are measured along. Pure; map/render.ts draws them.
import { t } from '../../../core/i18n.ts'
import { FeatureProps } from '../model/model.ts'
import { North, fromNorth, northLetter } from './north.ts'
import { TickView, along, readableAngle, segmentsOf, ticksAlong } from './ticks.ts'
import {
  LngLat,
  area,
  bearing,
  circle,
  destination,
  distance,
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

/**
 * The points with one leg (from point i to i + 1) made `metres` long: its end moves
 * along the same bearing, and the legs after it keep their own length and bearing.
 */
export function withLegLength(points: LngLat[], i: number, metres: number): LngLat[] {
  const out = points.slice(0, i + 1)
  for (let j = i; j < points.length - 1; j++) {
    const [a, b] = [points[j], points[j + 1]]
    const length = j === i ? metres : distance(a, b)
    out.push(destination(out[j], length, bearing(a, b)))
  }
  return out
}

/** A measurement's legs (an area's closing one too): their lengths and bearings. */
export function legsOf(m: Measurement): { length: number; from: LngLat; to: LngLat }[] {
  const points = m.type === 'area' ? [...m.points, m.points[0]] : m.points
  return points.slice(1).map((to, i) => ({ length: distance(points[i], to), from: points[i], to }))
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

export interface DrawOptions {
  /** The one being drawn (to the cursor): dashed, no marks. */
  draft?: boolean
  north?: North
  /** Where marks go along distances (none: no marks). */
  ticks?: TickView
  /** Copied onto every feature (the item's id, its colour). */
  properties?: Record<string, unknown>
}

// Labels: turned along the line (rotate), beside it (offset in ems, anchor), and
// which one wins when two would overlap (priority: lower first).
type Placement = { rotate?: number; offset?: [number, number]; anchor?: string; priority: number }

/** Where a label goes beyond the end of a line heading `angle` (screen degrees). */
function beyond(angle: number): Placement {
  const [c, s] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)]
  if (c > 0.7) return { anchor: 'left', offset: [0.6, 0], priority: 0 }
  if (c < -0.7) return { anchor: 'right', offset: [-0.6, 0], priority: 0 }
  return s > 0
    ? { anchor: 'top', offset: [0, 0.6], priority: 0 }
    : { anchor: 'bottom', offset: [0, -0.6], priority: 0 }
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
  const label = (at: LngLat, text: string, placement: Placement, extra: Record<string, unknown> = {}) =>
    point(at, { ...props, label: text, ...placement, ...extra })
  const out: GeoJSON.Feature[] = []
  if (m.type === 'rings') {
    const centre = m.points[0]
    out.push(point(centre, { ...props, vertex: true }))
    // Labelled outside each ring, north, east, south and west (one is on screen
    // even when it's big).
    const sides: Placement[] = [
      { anchor: 'bottom', offset: [0, -0.3], priority: 1 },
      { anchor: 'left', offset: [0.4, 0], priority: 1 },
      { anchor: 'top', offset: [0, 0.3], priority: 1 },
      { anchor: 'right', offset: [-0.4, 0], priority: 1 }
    ]
    for (const radius of m.radii ?? []) {
      const ring = circle(centre, radius)
      out.push(line(ring))
      for (let i = 0; i < 4; i++)
        out.push(label(ring[(i * (ring.length - 1)) / 4], formatDistance(radius), sides[i]))
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
      out.push(label(centre, formatArea(area(m.points)), { priority: 0 }, { big: true }))
    }
    out.push(line(ring))
    return out
  }
  out.push(line(greatCirclePath(m.points)))
  if (options.ticks && !options.draft) out.push(...ticksAlong(m.points, options.ticks, props))
  // Each leg: its length and bearing, beside it and along it; the end: the total.
  let lastAngle = 0
  for (let i = 1; i < m.points.length; i++) {
    const [a, b] = [m.points[i - 1], m.points[i]]
    const segments = segmentsOf(greatCirclePath([a, b]))
    if (!segments.length) continue
    const last = segments[segments.length - 1]
    const mid = along(
      segments.find((s) => s.start + s.length >= (last.start + last.length) / 2) ?? last,
      (last.start + last.length) / 2
    )
    lastAngle = along(last, last.start + last.length).angle
    out.push(
      label(mid.point, `${formatDistance(pathLength([a, b]))} · ${legBearing(a, b, north)}`, {
        rotate: readableAngle(mid.angle),
        // Above the line (the marks' labels are under it).
        offset: [0, -0.7],
        anchor: 'bottom',
        priority: 1
      })
    )
  }
  if (m.points.length > 2) {
    out.push(
      label(m.points[m.points.length - 1], formatDistance(pathLength(m.points)), beyond(lastAngle), {
        big: true
      })
    )
  }
  return out
}
