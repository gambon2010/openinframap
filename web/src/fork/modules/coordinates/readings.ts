// Fork: what the coordinates box says besides where the cursor is: the magnetic
// declination there, and how far and which way it is from the last click (the
// north bearings are measured from: My layers' setting, services/measure-prefs.ts).
import { formatDistance, bearing, type LngLat } from '../../core/earth.ts'
import { groundDistance } from '../../core/geo.ts'
import { declination, fromNorth, northLetter, type North } from '../../core/north.ts'

/** "Decl. 2.6° E": how far a compass points from true north (east or west). */
export function formatDeclination(lng: number, lat: number, when?: Date): string {
  const degrees = declination(lng, lat, when)
  const side = degrees >= 0 ? 'E' : 'W'
  return `${Math.abs(degrees).toFixed(1)}° ${side}`
}

/** "1.24 km 047°M": how far, and the bearing, from a point to another, the bearing
 * from the north chosen (as the measuring tool gives it, without the mils). */
export function fromPoint(from: LngLat, to: LngLat, north: North): string {
  const trueBearing = bearing(from, to)
  const degrees = Math.round(fromNorth(trueBearing, north, from[0], from[1])) % 360
  return `${formatDistance(groundDistance(from, to))} ${String(degrees).padStart(3, '0')}°${northLetter(north)}`
}
