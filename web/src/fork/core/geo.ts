// Fork: small geographic helpers shared by modules (no UI): degrees and radians, how
// many metres a screen pixel covers at a zoom (web Mercator, 512-pixel tiles) and
// the map's scale there, the
// distance on the ground between two places, and the area inside a ring (Turf's, on
// the sphere of the Earth's mean radius).
import turfArea from '@turf/area'
import turfDistance from '@turf/distance'

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

/** A screen pixel in the OGC's standard (0.28 mm): what a map's scale is counted in. */
export const OGC_PIXEL_M = 0.00028

/** The map's scale (1:n) at a zoom and latitude. */
export function mapScale(zoom: number, lat: number): number {
  return metresPerPixel(lat, zoom) / OGC_PIXEL_M
}

/** The zoom a scale (1:n) is drawn at, at a latitude: mapScale's inverse. */
export function zoomForScale(scale: number, lat: number): number {
  return Math.log2((EARTH_CIRCUMFERENCE_M * Math.cos(toRadians(lat))) / (TILE_PIXELS * scale * OGC_PIXEL_M))
}

/** Metres on the ground between two [longitude, latitude] places (haversine). */
export function groundDistance(a: [number, number], b: [number, number]): number {
  return turfDistance(a, b, { units: 'meters' })
}

/** Square metres inside a ring of [longitude, latitude] (closed or not), on the sphere. */
export function groundArea(ring: [number, number][]): number {
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1]
  const points = ring.length > 1 && same(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring
  if (points.length < 3) return 0
  return turfArea({ type: 'Polygon', coordinates: [[...points, points[0]]] })
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
