// Fork: the fields of a military symbol's card (fields.ts): its constants and tables.
import { SymbolKind } from './sidc.ts'
import type { Field } from './fields.types.ts'

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
  {
    key: 'T1',
    label: 'Second designation',
    input: 'text',
    kinds: ['graphic'],
    help: 'A second name, written on the other side of the graphic'
  },
  {
    key: 'M',
    label: 'Higher formation',
    input: 'text',
    kinds: ['unit', 'installation'],
    help: 'The formation it belongs to ("3rd Bde"), written beside the symbol'
  },
  {
    key: 'V',
    label: 'Type',
    input: 'text',
    kinds: ['equipment'],
    help: 'Which equipment it is ("Leopard 2A6")'
  },
  {
    key: 'C',
    label: 'Quantity',
    input: 'number',
    kinds: ['equipment'],
    min: 0,
    help: 'How many'
  },
  {
    key: 'G',
    label: 'Staff comments',
    input: 'textarea',
    kinds: [...ALL_SYMBOLS, 'graphic'],
    help: 'Written beside the symbol on the map (unlike Notes, which stay in the card)'
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
    kinds: ['unit', 'equipment', 'installation', 'activity'],
    help: 'How able it is to fight ("70 %", "green")'
  },
  // Time
  {
    key: 'W',
    label: 'Date-time group',
    input: 'datetime',
    kinds: ALL_SYMBOLS,
    help: 'When it was seen or reported (the timeline shows it from then)'
  },
  {
    key: 'W',
    label: 'Effective from',
    input: 'datetime',
    kinds: ['graphic'],
    help: 'When it starts to apply'
  },
  {
    key: 'W1',
    label: 'Effective to',
    input: 'datetime',
    kinds: ['graphic'],
    help: 'When it stops applying'
  },
  // Movement
  {
    key: 'Q',
    label: 'Direction of movement',
    input: 'number',
    quantity: 'angle',
    kinds: ['unit', 'equipment', 'activity'],
    min: 0,
    max: 360,
    help: 'Which way it moves, from north: an arrow from the symbol'
  },
  {
    key: 'Z',
    label: 'Speed',
    input: 'number',
    quantity: 'speed',
    kinds: ['unit', 'equipment', 'activity'],
    min: 0,
    help: "How fast it moves. Changing the unit doesn't convert the number."
  },
  // Geometry (graphics)
  {
    key: 'X',
    label: 'Altitude / depth',
    input: 'text',
    quantity: 'altitude',
    kinds: ['graphic'],
    help: 'One value, or "min,max" for airspace. Changing the unit doesn\'t convert the number.'
  },
  {
    key: 'AM',
    label: 'Width / radius / length',
    input: 'text',
    quantity: 'distance',
    kinds: ['graphic'],
    min: 0,
    help: "For corridors, circles and rectangles. Changing the unit doesn't convert the number."
  },
  {
    key: 'AN',
    label: 'Attitude',
    input: 'number',
    quantity: 'angle',
    kinds: ['graphic'],
    min: 0,
    max: 360,
    help: 'Which way it points, from north'
  }
]

/** The date-time groups' letters (not drawn on the map: modifiersToDraw). */
export const DATE_KEYS = ['W', 'W1']

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

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
