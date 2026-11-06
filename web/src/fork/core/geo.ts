// Fork: small geographic helpers shared by modules (no UI): degrees and radians, how
// many metres a screen pixel covers at a zoom (web Mercator, 512-pixel tiles), and
// the distance on the ground between two places.

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
