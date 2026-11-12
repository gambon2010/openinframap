import { groundDistance, toDegrees, toRadians } from '../../../core/geo.ts'
// Fork: distances, areas, bearings and circles on the Earth (a sphere of the mean
// radius: within 0.5 % of the ellipsoid, enough to measure on a map). Pure.
export type LngLat = [lng: number, lat: number]

const R = 6371008.8

/** Metres in each distance unit people type (nautical miles: 1852 m). */
const UNIT_METRES = { m: 1, km: 1000, nm: 1852 } as const
type DistanceUnit = keyof typeof UNIT_METRES
const rad = toRadians
const deg = toDegrees

/** Metres along a path. */
export function pathLength(points: LngLat[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += groundDistance(points[i - 1], points[i])
  return total
}

/** The initial bearing from one point to another: degrees from true north, 0–360. */
export function bearing([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2))
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** The point a distance (metres) away on a bearing (degrees). */
export function destination([lng, lat]: LngLat, metres: number, bearingDeg: number): LngLat {
  const d = metres / R
  const b = rad(bearingDeg)
  const lat2 = Math.asin(Math.sin(rad(lat)) * Math.cos(d) + Math.cos(rad(lat)) * Math.sin(d) * Math.cos(b))
  const lng2 =
    rad(lng) +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(rad(lat)),
      Math.cos(d) - Math.sin(rad(lat)) * Math.sin(lat2)
    )
  return [((deg(lng2) + 540) % 360) - 180, deg(lat2)]
}

/** The point a fraction of the way from a to b along the great circle. */
export function intermediate([lng1, lat1]: LngLat, [lng2, lat2]: LngLat, f: number): LngLat {
  const d = groundDistance([lng1, lat1], [lng2, lat2]) / R
  if (d === 0) return [lng1, lat1]
  const A = Math.sin((1 - f) * d) / Math.sin(d)
  const B = Math.sin(f * d) / Math.sin(d)
  const [φ1, λ1, φ2, λ2] = [rad(lat1), rad(lng1), rad(lat2), rad(lng2)]
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2)
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2)
  const z = A * Math.sin(φ1) + B * Math.sin(φ2)
  return [deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]
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
    for (let k = 1; k < n; k++) out.push(intermediate(a, b, k / n))
    out.push(b)
  }
  return out
}

/** A circle of a radius (metres) round a centre, as a closed ring. */
export function circle(centre: LngLat, metres: number, steps = 96): LngLat[] {
  const ring: LngLat[] = []
  for (let i = 0; i < steps; i++) ring.push(destination(centre, metres, (i * 360) / steps))
  ring.push(ring[0])
  return ring
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
