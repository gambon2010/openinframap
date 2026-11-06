// Fork: the fields of a military symbol's card (fields.ts): its constants and tables.
import { SymbolKind } from './sidc.ts'
import type { Field, Group } from './fields.types.ts'

export const ALL_SYMBOLS: SymbolKind[] = ['unit', 'equipment', 'installation', 'activity', 'other']

export const FIELDS: Field[] = [
  // Labels
  {
    key: 'T',
    label: 'Unique designation',
    input: 'text',
    kinds: [...ALL_SYMBOLS, 'graphic'],
    help: 'The name that identifies it ("2nd Bn", "OBJ LION")'
  },
  { key: 'T1', label: 'Second designation', input: 'text', kinds: ['graphic'] },
  { key: 'M', label: 'Higher formation', input: 'text', kinds: ['unit', 'installation'] },
  { key: 'V', label: 'Type', input: 'text', kinds: ['equipment'] },
  { key: 'C', label: 'Quantity', input: 'number', kinds: ['equipment'] },
  {
    key: 'H',
    label: 'Additional information',
    input: 'text',
    kinds: [...ALL_SYMBOLS, 'graphic']
  },
  {
    key: 'G',
    label: 'Staff comments',
    input: 'textarea',
    kinds: [...ALL_SYMBOLS, 'graphic']
  },
  // Assessment
  {
    key: 'F',
    label: 'Reinforced / reduced',
    input: 'text',
    kinds: ['unit'],
    help: '+ reinforced, − reduced, ± both'
  },
  {
    key: 'J',
    label: 'Evaluation rating',
    input: 'rating',
    kinds: ALL_SYMBOLS,
    help: 'Reliability of the source (A–F) and credibility of the information (1–6)'
  },
  {
    key: 'K',
    label: 'Combat effectiveness',
    input: 'text',
    kinds: ['unit', 'equipment', 'installation', 'activity']
  },
  // Time
  { key: 'W', label: 'Date-time group', input: 'datetime', kinds: ALL_SYMBOLS },
  { key: 'W', label: 'Effective from', input: 'datetime', kinds: ['graphic'] },
  { key: 'W1', label: 'Effective to', input: 'datetime', kinds: ['graphic'] },
  // Movement
  {
    key: 'Q',
    label: 'Direction of movement',
    input: 'number',
    unit: '°',
    kinds: ['unit', 'equipment', 'activity']
  },
  {
    key: 'Z',
    label: 'Speed',
    input: 'number',
    unit: 'km/h',
    kinds: ['unit', 'equipment', 'activity']
  },
  // Geometry (graphics)
  {
    key: 'X',
    label: 'Altitude / depth',
    input: 'text',
    kinds: ['graphic'],
    help: 'One value, or "min,max" for airspace'
  },
  {
    key: 'AM',
    label: 'Width / radius / length',
    input: 'text',
    unit: 'm',
    kinds: ['graphic'],
    help: 'For corridors, circles and rectangles'
  },
  { key: 'AN', label: 'Attitude', input: 'number', unit: '°', kinds: ['graphic'] }
]

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export const GROUPS: [Group, string][] = [
  ['who', 'Who'],
  ['what', 'What'],
  ['when', 'When'],
  ['where', 'Where and movement'],
  ['sure', 'How sure']
]

/** Which question each field answers. */
export const FIELD_GROUP: Record<string, Group> = {
  T: 'who',
  T1: 'who',
  M: 'who',
  V: 'what',
  C: 'what',
  H: 'what',
  W: 'when',
  W1: 'when',
  Q: 'where',
  Z: 'where',
  X: 'where',
  AM: 'where',
  AN: 'where',
  F: 'sure',
  J: 'sure',
  K: 'sure',
  G: 'sure'
}

/** Shown on the card even when empty, ready to fill in (anything filled in is shown too). */
export const DEFAULT_FIELDS: Record<SymbolKind, string[]> = {
  unit: ['T', 'M', 'W'],
  equipment: ['T', 'V', 'C', 'W'],
  installation: ['T', 'W'],
  activity: ['T', 'W'],
  graphic: ['T', 'W', 'W1'],
  other: ['T', 'V', 'W']
}

export const RELIABILITY: Record<string, string> = {
  A: 'completely reliable',
  B: 'usually reliable',
  C: 'fairly reliable',
  D: 'not usually reliable',
  E: 'unreliable',
  F: 'reliability unknown'
}

export const CREDIBILITY: Record<string, string> = {
  '1': 'confirmed',
  '2': 'probably true',
  '3': 'possibly true',
  '4': 'doubtful',
  '5': 'improbable',
  '6': 'truth unknown'
}
