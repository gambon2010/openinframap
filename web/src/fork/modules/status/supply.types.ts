// Fork: power supply mode (supply.ts): its types.
import { Supply } from '../../services/supply.ts'

/** Per id: a line's circuits ({s1: "red"}) or a station ("red"). */
export interface States {
  lines: Record<string, Record<string, string>>
  stations: Record<string, string>
}

export interface SupplyResult extends States {
  /** The grid build (for GET /grid/supply/unconnected). */
  grid: string
  lost: number
  /** How many features have Suspected damage. */
  suspected: number
  counts: Record<'red' | 'orange' | 'risk', Record<string, number>>
  features: Record<string, Supply>
}
