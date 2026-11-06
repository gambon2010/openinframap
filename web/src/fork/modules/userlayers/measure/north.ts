// Fork: which north a bearing is measured from. True north: the direction of the
// pole (what geo.ts's bearing gives). Magnetic north: where a compass points
// (declination from the World Magnetic Model 2025, `magvar`, offline; valid to
// 2030). Grid north: "up" on the UTM/MGRS grid (its convergence from true north).
import { magvar } from 'magvar'
import { toDegrees, toRadians } from '../../../core/geo.ts'

export type North = 'true' | 'magnetic' | 'grid'

/** How far magnetic north is from true north, degrees (east positive). */
export function declination(lng: number, lat: number, when: Date = new Date()): number {
  return magvar(lat, lng, 0, when)
}

/** How far grid north (UTM, MGRS) is from true north, degrees (east positive). */
export function gridConvergence(lng: number, lat: number): number {
  const zone = Math.min(60, Math.floor((lng + 180) / 6) + 1)
  const central = zone * 6 - 183
  return toDegrees(Math.atan(Math.tan(toRadians(lng - central)) * Math.sin(toRadians(lat))))
}

/** How far a north is from true north at a place, degrees (east positive). */
export function offset(north: North, lng: number, lat: number, when?: Date): number {
  if (north === 'magnetic') return declination(lng, lat, when)
  if (north === 'grid') return gridConvergence(lng, lat)
  return 0
}

/** A bearing from true north, measured from another north instead (0–360). */
export function fromNorth(trueBearing: number, north: North, lng: number, lat: number, when?: Date): number {
  return (((trueBearing - offset(north, lng, lat, when)) % 360) + 360) % 360
}

/** The letter after a bearing's degrees: T, M or G. */
export function northLetter(north: North): string {
  return { true: 'T', magnetic: 'M', grid: 'G' }[north]
}
