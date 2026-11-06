// Fork: the fields of a military symbol's card (fields.ts): its types.
import { SymbolKind } from './sidc.ts'

export type FieldInput = 'text' | 'textarea' | 'number' | 'datetime' | 'rating'

export interface Field {
  /** The modifier letter(s) of the standard. */
  key: string
  label: string
  section: 'labels' | 'assessment' | 'time' | 'movement' | 'geometry'
  input: FieldInput
  kinds: SymbolKind[]
  /** For number fields. */
  unit?: string
  help?: string
}

/** How much of the labels the map shows (a map setting). */
export type LabelLevel = 'none' | 'name' | 'all'

export type Group = 'who' | 'what' | 'when' | 'where' | 'sure'
