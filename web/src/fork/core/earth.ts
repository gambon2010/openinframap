// Fork: distances, areas, bearings and circles on the Earth (Turf's, on a sphere of
// the mean radius: within 0.5 % of the ellipsoid, enough to measure on a map), and
// distances and bearings written for people. Pure.
import turfBearing from '@turf/bearing'
import turfCircle from '@turf/circle'
import turfDestination from '@turf/destination'
import greatCircle from '@turf/great-circle'
import { lineString } from '@turf/helpers'
import turfLength from '@turf/length'
import { groundDistance } from './geo.ts'

export type LngLat = [lng: number, lat: number]

/** Metres in each distance unit people type (nautical miles: 1852 m). */
const UNIT_METRES = { m: 1, km: 1000, nm: 1852 } as const
type DistanceUnit = keyof typeof UNIT_METRES

/** Metres along a path. */
export function pathLength(points: LngLat[]): number {
  if (points.length < 2) return 0
  return turfLength(lineString(points), { units: 'meters' })
}

/** The initial bearing from one point to another: degrees from true north, 0–360
 * (Turf's run from -180 to 180). */
export function bearing(from: LngLat, to: LngLat): number {
  return (turfBearing(from, to) + 360) % 360
}

/** The point a distance (metres) away on a bearing (degrees), its longitude within
 * -180 to 180. */
export function destination(from: LngLat, metres: number, bearingDeg: number): LngLat {
  const [lng, lat] = turfDestination(from, metres, bearingDeg, { units: 'meters' }).geometry.coordinates
  return [((lng + 540) % 360) - 180, lat]
}

// Legs longer than this are drawn through points along their great circle (close
// enough that straight pieces on the flat map stay within a metre of it).
const SEGMENT = 2000

/**
 * A path drawn as the great circles its distance is measured along (on the flat
 * map a long leg curves; a straight line there would be another, longer path).
 */
export function greatCirclePath(points: LngLat[]): LngLat[] {
  const out: LngLat[] = points.slice(0, 1)
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const n = Math.min(2000, Math.ceil(groundDistance(a, b) / SEGMENT))
    out.push(...greatCircleLeg(a, b, n).slice(1))
  }
  return out
}

/** A leg's great circle in `pieces` straight pieces (its two ends included). */
function greatCircleLeg(a: LngLat, b: LngLat, pieces: number): LngLat[] {
  if (pieces <= 1 || (a[0] === b[0] && a[1] === b[1])) return [a, b]
  const arc = greatCircle(a, b, { npoints: pieces + 1 }).geometry
  // A leg across the antimeridian comes as two lines: kept end to end.
  const coordinates = arc.type === 'LineString' ? arc.coordinates : arc.coordinates.flat()
  return [a, ...(coordinates.slice(1, -1) as LngLat[]), b]
}

/** A circle of a radius (metres) round a centre, as a closed ring: clockwise from
 * north (Turf's runs the other way: the range rings' labels are placed north, east,
 * south and west by their quarter points). */
export function circle(centre: LngLat, metres: number, steps = 96): LngLat[] {
  const ring = turfCircle(centre, metres, { units: 'meters', steps }).geometry.coordinates[0] as LngLat[]
  return ring.reverse()
}

/** A number with at most `decimals` decimals (none trailing) and thousands separated. */
function number(value: number, decimals: number): string {
  return value.toLocaleString('en', { maximumFractionDigits: decimals })
}

/** "850 m", "1.23 km", "12.4 km", "1,284 km", "5 km". */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  const km = metres / 1000
  return `${number(km, km < 10 ? 2 : km < 100 ? 1 : 0)} km`
}

/** To the metre, for typing over: "18 km 450 m", "18 km", "450 m". */
export function formatLength(metres: number): string {
  const total = Math.round(metres)
  const km = Math.floor(total / 1000)
  const m = total - km * 1000
  if (!km) return `${m} m`
  return m ? `${km} km ${m} m` : `${km} km`
}

/** A length as typed ("18 km 450 m", "2.5 km", "800 m", "3 nm"; a bare number:
 * metres) in metres; null if there's none. */
export function parseLength(text: string): number | null {
  let total = 0
  let found = false
  for (const [, number, unit] of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(km|nm|m)?/gi)) {
    const value = parseFloat(number.replace(',', '.'))
    if (!Number.isFinite(value)) continue
    total += value * (UNIT_METRES[(unit ?? 'm').toLowerCase() as DistanceUnit] ?? 1)
    found = true
  }
  return found && total > 0 ? total : null
}

/** "047° (836 mils)": degrees, and NATO mils (6400 to a full turn); with the north
 * it's from ("047°M (836 mils)"). */
export function formatBearing(degrees: number, north = ''): string {
  const mils = Math.round((degrees * 6400) / 360) % 6400
  return `${String(Math.round(degrees) % 360).padStart(3, '0')}°${north} (${mils} mils)`
}

/** Distances typed for range rings: "1, 5, 10 km", "500 m, 2.5km", "3 nm" → metres. */
export function parseDistances(text: string): number[] {
  const out: number[] = []
  // A unit applies to the numbers before it that have none ("1, 5, 10 km").
  let waiting: number[] = []
  for (const [, number, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*(km|nm|m)?/gi)) {
    const value = parseFloat(number)
    if (!(value > 0)) continue
    waiting.push(value)
    if (unit) {
      const factor = UNIT_METRES[unit.toLowerCase() as DistanceUnit]
      out.push(...waiting.map((v) => v * factor))
      waiting = []
    }
  }
  // No unit at the end: kilometres.
  out.push(...waiting.map((v) => v * 1000))
  return [...new Set(out)].sort((a, b) => a - b)
}
