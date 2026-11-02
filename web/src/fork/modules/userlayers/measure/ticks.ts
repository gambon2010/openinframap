// Fork: the marks along a measured distance, like a ruler's: small ones every
// `minor`, longer labelled ones every `major` (from the start: "5 km"). How far
// apart they are depends on the zoom: never closer than about 15 px on screen
// (labels about 90 px), down to 10 m when zoomed in a lot; always round steps (1, 2
// or 5 × 10ⁿ). Only the marks in view are made: zoomed in on a long line there
// would be far too many. Pure.
import { LngLat, bearing, destination, distance, intermediate } from './geo.ts'

/** Where the marks are drawn: the zoom, and what's in view (none: everywhere). */
export interface TickView {
  zoom: number
  bounds?: { west: number; south: number; east: number; north: number }
}

const MIN_STEP = 10
const MINOR_PX = 15
const MAJOR_PX = 90
const MINOR_HALF_PX = 4
const MAJOR_HALF_PX = 7
// Beyond this many candidate marks, none (a line far longer than the view).
const MAX_CANDIDATES = 300000

/** Metres per screen pixel at a latitude and zoom (512-pixel tiles). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
}

/** The smallest of 1, 2, 5 × 10ⁿ that is at least x. */
export function niceAtLeast(x: number): number {
  const power = 10 ** Math.floor(Math.log10(x))
  for (const f of [1, 2, 5, 10]) if (f * power >= x * (1 - 1e-9)) return f * power
  return 10 * power
}

/** The marks' steps for a scale: minor, and major (a multiple of minor). */
export function tickSteps(metresPerPx: number): { minor: number; major: number } {
  const minor = Math.max(MIN_STEP, niceAtLeast(metresPerPx * MINOR_PX))
  let major = Math.max(minor, niceAtLeast(metresPerPx * MAJOR_PX))
  while (Math.abs(major / minor - Math.round(major / minor)) > 1e-9) major = niceAtLeast(major * 1.001)
  return { minor, major }
}

/** "800 m", "5 km", "2.5 km", "1,200 km". */
export function formatTick(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toLocaleString('en', { maximumFractionDigits: 2 })} km`
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
  const b = view.bounds
  const lat = b ? (b.south + b.north) / 2 : points.reduce((s, p) => s + p[1], 0) / points.length
  const { minor, major } = tickSteps(metresPerPixel(lat, view.zoom))
  const legs = points.slice(1).map((p, i) => distance(points[i], p))
  if (legs.reduce((s, l) => s + l, 0) / minor > MAX_CANDIDATES) return []
  const out: GeoJSON.Feature[] = []
  let start = 0
  for (let i = 0; i < legs.length; i++) {
    const [a, z] = [points[i], points[i + 1]]
    const length = legs[i]
    for (let d = Math.floor(start / minor + 1) * minor; d < start + length; d += minor) {
      const p = intermediate(a, z, (d - start) / length)
      if (!inView(p, view)) continue
      const isMajor = Math.abs(d / major - Math.round(d / major)) < 1e-6
      const half = (isMajor ? MAJOR_HALF_PX : MINOR_HALF_PX) * metresPerPixel(p[1], view.zoom)
      const across = bearing(p, z) + 90
      out.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [destination(p, half, across), destination(p, half, across + 180)]
        },
        properties: { ...properties, tick: isMajor ? 'major' : 'minor' }
      })
      if (isMajor) {
        out.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: p },
          properties: { ...properties, tickLabel: formatTick(d) }
        })
      }
    }
    start += length
  }
  return out
}
