// Fork: the units a detail's value is given in (units.ts).

/** What a detail measures. */
export type Quantity = 'speed' | 'distance' | 'altitude' | 'angle'

/** A unit: its symbol as written after the value, and how many of the quantity's
 * first unit it is. */
export interface Unit {
  symbol: string
  factor: number
}
