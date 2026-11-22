// Fork: the units a detail's value is given in (units.ts), the first of each the
// one a value without a unit is in.
import type { Quantity, Unit } from './units.types.ts'

/** Knots and nautical miles by their definition (1852 m), feet and miles as the
 * international foot (0.3048 m); mils as NATO's, 6400 to a turn (as the measuring
 * tools': core/earth.ts). */
export const UNITS: Record<Quantity, Unit[]> = {
  speed: [
    { symbol: 'km/h', factor: 1 },
    { symbol: 'kn', factor: 1.852 },
    { symbol: 'mph', factor: 1.609344 }
  ],
  distance: [
    { symbol: 'm', factor: 1 },
    { symbol: 'km', factor: 1000 },
    { symbol: 'nm', factor: 1852 }
  ],
  altitude: [
    { symbol: 'm', factor: 1 },
    { symbol: 'ft', factor: 0.3048 }
  ],
  angle: [
    { symbol: '°', factor: 1 },
    { symbol: 'mils', factor: 360 / 6400 }
  ]
}
