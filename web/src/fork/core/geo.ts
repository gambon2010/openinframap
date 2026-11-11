// Fork: small geographic helpers shared by modules (no UI): degrees and radians, how
// many metres a screen pixel covers at a zoom (web Mercator, 512-pixel tiles), the
// distance on the ground between two places, and the area inside a ring.

/** The Earth's circumference at the equator, metres (web Mercator's sphere). */
export const EARTH_CIRCUMFERENCE_M = 40075016.686
/** Pixels across a tile at zoom 0 (MapLibre's 512). */
export const TILE_PIXELS = 512

export const toRadians = (degrees: number) => (degrees * Math.PI) / 180
export const toDegrees = (radians: number) => (radians * 180) / Math.PI

/** Metres per screen pixel at a latitude and zoom. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(toRadians(lat))) / (TILE_PIXELS * 2 ** zoom)
}

/** The Earth's mean radius, metres. */
const EARTH_RADIUS_M = 6371008.8

/** Metres on the ground between two [longitude, latitude] places (haversine). */
export function groundDistance([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** Square metres inside a ring of [longitude, latitude] (closed or not), on the sphere. */
export function groundArea(ring: [number, number][]): number {
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1]
  const points = ring.length > 1 && same(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [lng1, lat1] = points[i]
    const [lng2, lat2] = points[(i + 1) % points.length]
    sum += toRadians(lng2 - lng1) * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)))
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2)
}

/** "450 m²", "3.2 ha", "12.5 km²", "4,096 km²". */
export function formatArea(m2: number): string {
  const number = (value: number, decimals: number) =>
    value.toLocaleString('en', { maximumFractionDigits: decimals })
  if (m2 < 10000) return `${Math.round(m2)} m²`
  if (m2 < 1e6) return `${number(m2 / 10000, 1)} ha`
  const km2 = m2 / 1e6
  return `${number(km2, km2 < 100 ? 1 : 0)} km²`
}
