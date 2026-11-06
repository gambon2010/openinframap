// Fork: the marks along a measured distance, like a ruler's: a labelled mark every
// `major` ("18 km", "18 km 200 m") from the start (marked too), with one plain mark
// halfway between (on a full value: majors are 1 or 2 × 10ⁿ; a 5 × 10ⁿ step has
// none, its half isn't one). How far apart depends on the zoom: labels about 80 px
// apart, never under 20 m. A measurement too short for four labelled steps of that
// size gets smaller steps (5 → 2 → 1 km...), down to labels 45 px apart; only when
// even those don't fit (zoomed far out) are there no marks. Only the marks in view
// are made. Pure.
//
// Marks sit on the line as drawn: the great-circle path (geo.ts greatCirclePath),
// straight on the flat map between its points, and across it as seen on screen.
import { LngLat, distance, greatCirclePath } from './geo.ts'
import { metresPerPixel, toDegrees, toRadians } from '../../../core/geo.ts'
import { clamp } from '../../../core/math.ts'
import type { TickView, XY, Segment } from './ticks.types.ts'

const MAJOR_PX = 80

const MIN_MAJOR = 20

// Fewer labelled steps than this along the whole measurement: smaller steps, or no
// marks (one or two lone marks say little).
const MIN_MAJORS = 4

// Labels closer than this on screen (smaller steps for a short measurement): too
// crowded, no marks.
const MIN_LABEL_PX = 45

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

/** The labelled step for a scale, and the plain mark halfway (null: none). */
export function tickSteps(metresPerPx: number): { major: number; minor: number | null } {
  return withMinor(Math.max(MIN_MAJOR, niceAtLeast(metresPerPx * MAJOR_PX)))
}

/** A labelled step and its plain mark halfway (none for 5 × 10ⁿ: its half isn't a
 * full value). */
function withMinor(major: number): { major: number; minor: number | null } {
  return { major, minor: leadDigit(major) === 5 ? null : major / 2 }
}

function leadDigit(step: number): number {
  return Math.round(step / 10 ** Math.floor(Math.log10(step)))
}

/** The next smaller step of 1, 2, 5 × 10ⁿ: 5 → 2, 2 → 1, 1 → 0.5. */
export function smallerStep(step: number): number {
  return leadDigit(step) === 5 ? (step * 2) / 5 : step / 2
}

/** The steps for a measurement `total` metres long: the usual ones, or smaller
 * ones so at least MIN_MAJORS fit, while labels stay MIN_LABEL_PX apart; null: none. */
export function stepsFor(total: number, metresPerPx: number): { major: number; minor: number | null } | null {
  let steps = tickSteps(metresPerPx)
  while (total < MIN_MAJORS * steps.major) {
    const smaller = smallerStep(steps.major)
    if (smaller < MIN_MAJOR || smaller / metresPerPx < MIN_LABEL_PX) return null
    steps = withMinor(smaller)
  }
  return steps
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
    const length = distance(path[i - 1], path[i])
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
  const steps = stepsFor(total, mpp)
  if (!steps) return []
  const { major, minor } = steps
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
