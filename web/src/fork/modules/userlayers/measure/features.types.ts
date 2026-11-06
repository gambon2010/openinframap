// Fork: measurements drawn on the map (features.ts): its types.
import { North } from './north.ts'
import { TickView } from './ticks.types.ts'
import { LngLat } from './geo.ts'

export type MeasureType = 'distance' | 'area' | 'rings'

export interface Measurement {
  type: MeasureType
  points: LngLat[]
  /** Range rings: their radii in metres. */
  radii?: number[]
}

export interface DrawOptions {
  /** The one being drawn (to the cursor): dashed, no marks. */
  draft?: boolean
  north?: North
  /** Where marks go along distances (none: no marks). */
  ticks?: TickView
  /** The map's zoom (labels too long for their leg on screen get shorter). */
  zoom?: number
  /** Copied onto every feature (the item's id, its colour). */
  properties?: Record<string, unknown>
}

// Labels: turned along the line (rotate), beside it (offset in ems, anchor), and
// which one wins when two would overlap (priority: lower first).
export type Placement = { rotate?: number; offset?: [number, number]; anchor?: string; priority: number }
