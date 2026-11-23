// Fork: the fields of a military symbol's card (fields.ts): its types.
import type { Quantity } from './units.types.ts'
import { SymbolKind } from './sidc.ts'

export type FieldInput = 'text' | 'number' | 'datetime' | 'rating'

export interface Field {
  /** The modifier letter(s) of the standard. */
  key: string
  label: string
  input: FieldInput
  kinds: SymbolKind[]
  /** What it measures: its value is given in a unit chosen beside it (units.ts). */
  quantity?: Quantity
  /** Its name's key in en.json (userlayers.f.<it>), when two fields share a letter
   * (W: a unit's "Seen at", a graphic's "Effective from"); else its key. */
  stringKey?: string
  /** The values allowed, in its quantity's first unit (km/h, m, °). */
  min?: number
  max?: number
  help?: string
}

/** How much of the labels the map shows (a map setting). */
export type LabelLevel = 'none' | 'name' | 'all'
