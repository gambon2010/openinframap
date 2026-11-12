// Fork: the marks along a measured distance, like a ruler's: a labelled mark every
// `major` ("18 km", "18 km 200 m") from the start (marked too), with one plain mark
// halfway between (on a full value: majors are 1 or 2 × 10ⁿ; a 5 × 10ⁿ step has
// none, its half isn't one). Only the marks in view are made. Pure.
//
// One rule, like a ruler: the step is the smallest round distance (1, 2 or 5 × 10ⁿ
// m, never under 10 m) whose labelled marks land at least MIN_SPACING_PX apart on
// screen, so they're always 60 to 150 px apart, whatever the zoom; a measurement
// shorter than two steps on screen (tiny, zoomed far out) has none.
//
// Marks sit on the line as drawn: the great-circle path (geo.ts greatCirclePath),
// straight on the flat map between its points, and across it as seen on screen.
import { groundDistance } from '../../../core/geo.ts'
import { LngLat, greatCirclePath } from './geo.ts'
import { metresPerPixel, toDegrees, toRadians } from '../../../core/geo.ts'
import { clamp } from '../../../core/math.ts'
import type { TickView, XY, Segment } from './ticks.types.ts'

// Labelled marks at least this far apart on screen (room for "18 km").
const MIN_SPACING_PX = 60

// Never a step under this (zoomed in a lot).
const MIN_MAJOR = 10

// A measurement shorter than this many steps has no marks.
const MIN_STEPS = 2

const HALF_PX = { major: 7, minor: 4 }

// Beyond this many candidate marks, none (a line far longer than the view).
const MAX_CANDIDATES = 300000

// Metres per screen pixel at a latitude and zoom: core/geo.ts.
export { metresPerPixel }

/** The smallest of 1, 2, 5 × 10ⁿ that is at least x. */
export function niceAtLeast(x: number): number {
  const power = 10 ** Math.floor(Math.log10(x))
  for (const f of [1, 2, 5, 10]) if (f * power >= x * (1 - 1e-9)) return f * power
  return 10 * power
}

/** The labelled step for a scale, and the plain mark halfway (null: none, for a
 * step of 5 × 10ⁿ: its half isn't a full value). */
export function tickSteps(metresPerPx: number): { major: number; minor: number | null } {
  const major = Math.max(MIN_MAJOR, niceAtLeast(metresPerPx * MIN_SPACING_PX))
  const lead = Math.round(major / 10 ** Math.floor(Math.log10(major)))
  return { major, minor: lead === 5 ? null : major / 2 }
}

/** A mark's label: whole km when the step is ("18 km"), else km and m ("18 km 450 m"). */
export function formatTick(metres: number, major: number): string {
  const km = Math.floor(metres / 1000 + 1e-9)
  const m = Math.round(metres - km * 1000)
  if (major >= 1000 || (km && !m)) return `${Math.round(metres / 1000).toLocaleString('en')} km`
  if (!km) return `${m} m`
  return `${km.toLocaleString('en')} km ${m} m`
}

// --- The drawn line, in Web Mercator (0–1), where screen directions are true ---

export function toMercator([lng, lat]: LngLat): XY {
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2
  return [(lng + 180) / 360, y]
}

export function fromMercator([x, y]: XY): LngLat {
  return [x * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - 90]
}

/** A path's segments with their lengths (metres) and where each starts along it. */
export function segmentsOf(path: LngLat[]): Segment[] {
  const out: Segment[] = []
  let start = 0
  for (let i = 1; i < path.length; i++) {
    const length = groundDistance(path[i - 1], path[i])
    if (!length) continue
    out.push({ a: toMercator(path[i - 1]), b: toMercator(path[i]), start, length })
    start += length
  }
  return out
}

/** A point along a path, and the line's direction there on screen (degrees,
 * clockwise from east). */
export interface Along {
  point: LngLat
  merc: XY
  angle: number
}

export function along(segment: Segment, d: number): Along {
  const f = clamp((d - segment.start) / segment.length, 0, 1)
  const merc: XY = [
    segment.a[0] + (segment.b[0] - segment.a[0]) * f,
    segment.a[1] + (segment.b[1] - segment.a[1]) * f
  ]
  const angle = toDegrees(Math.atan2(segment.b[1] - segment.a[1], segment.b[0] - segment.a[0]))
  return { point: fromMercator(merc), merc, angle }
}

/** Text turned along a direction, never upside down (degrees for text-rotate). */
export function readableAngle(angle: number): number {
  let a = ((angle % 360) + 360) % 360
  if (a > 90 && a < 270) a -= 180
  return a > 180 ? a - 360 : a
}

function inView(p: LngLat, view: TickView): boolean {
  const b = view.bounds
  if (!b) return true
  // A little beyond the edges, so marks don't pop in as the map moves.
  const dx = (b.east - b.west) * 0.1
  const dy = (b.north - b.south) * 0.1
  return p[0] >= b.west - dx && p[0] <= b.east + dx && p[1] >= b.south - dy && p[1] <= b.north + dy
}

/** The marks along a path: short lines across it, and labels at the major ones. */
export function ticksAlong(
  points: LngLat[],
  view: TickView,
  properties: Record<string, unknown> = {}
): GeoJSON.Feature[] {
  if (points.length < 2) return []
  const segments = segmentsOf(greatCirclePath(points))
  if (!segments.length) return []
  const total = segments[segments.length - 1].start + segments[segments.length - 1].length
  const b = view.bounds
  const lat = b ? (b.south + b.north) / 2 : points.reduce((s, p) => s + p[1], 0) / points.length
  const mpp = metresPerPixel(lat, view.zoom)
  const { major, minor } = tickSteps(mpp)
  if (total < MIN_STEPS * major) return []
  const step = minor ?? major
  if (total / step > MAX_CANDIDATES) return []
  const world = 512 * 2 ** view.zoom
  const out: GeoJSON.Feature[] = []
  let s = 0
  for (let k = 0; k * step < total; k++) {
    const d = k * step
    while (s < segments.length - 1 && segments[s].start + segments[s].length < d) s++
    const at = along(segments[s], d)
    if (!inView(at.point, view)) continue
    const isMajor = Math.abs(d / major - Math.round(d / major)) < 1e-6
    // Across the line on screen, a few pixels each side.
    const half = (isMajor ? HALF_PX.major : HALF_PX.minor) / world
    const rad = toRadians(at.angle)
    const [nx, ny] = [-Math.sin(rad) * half, Math.cos(rad) * half]
    out.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          fromMercator([at.merc[0] + nx, at.merc[1] + ny]),
          fromMercator([at.merc[0] - nx, at.merc[1] - ny])
        ]
      },
      properties: { ...properties, tick: isMajor ? 'major' : 'minor' }
    })
    if (isMajor && d > 0) {
      out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: at.point },
        properties: {
          ...properties,
          tickLabel: formatTick(d, major),
          rotate: readableAngle(at.angle),
          // Under the line (the legs' labels are above it).
          offset: [0, 0.7],
          anchor: 'top',
          priority: 2
        }
      })
    }
  }
  return out
}
