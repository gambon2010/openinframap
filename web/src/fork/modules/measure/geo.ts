// Fork: distances, areas, bearings and circles on the Earth (a sphere of the mean
// radius: within 0.5 % of the ellipsoid, enough to measure on a map). Pure.
export type LngLat = [lng: number, lat: number]

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Metres between two points (haversine). */
export function distance([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Metres along a path. */
export function pathLength(points: LngLat[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i])
  return total
}

/** Square metres inside a ring (closed or not), on the sphere. */
export function area(ring: LngLat[]): number {
  const points = ring.length > 1 && same(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [lng1, lat1] = points[i]
    const [lng2, lat2] = points[(i + 1) % points.length]
    sum += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)))
  }
  return Math.abs((sum * R * R) / 2)
}

const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1]

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

/** "450 m²", "3.2 ha", "12.5 km²", "4,096 km²". */
export function formatArea(m2: number): string {
  if (m2 < 10000) return `${Math.round(m2)} m²`
  if (m2 < 1e6) return `${number(m2 / 10000, 1)} ha`
  const km2 = m2 / 1e6
  return `${number(km2, km2 < 100 ? 1 : 0)} km²`
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
      const factor = { km: 1000, m: 1, nm: 1852 }[unit.toLowerCase() as 'km' | 'm' | 'nm']
      out.push(...waiting.map((v) => v * factor))
      waiting = []
    }
  }
  // No unit at the end: kilometres.
  out.push(...waiting.map((v) => v * 1000))
  return [...new Set(out)].sort((a, b) => a - b)
}
