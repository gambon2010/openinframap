// Fork: the descriptive fields of a symbol (MIL-STD-2525C text modifiers, as ODIN
// shows them), by kind of symbol. They're stored in the feature's properties as
// `modifiers` ({T: "2nd Bn", W: "301200ZOCT26"...}) and drawn around the symbol.
// Identity, status, echelon and mobility live in the code itself (sidc.ts).
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

const ALL_SYMBOLS: SymbolKind[] = ['unit', 'equipment', 'installation', 'activity', 'other']

export const FIELDS: Field[] = [
  // Labels
  {
    key: 'T',
    label: 'Unique designation',
    section: 'labels',
    input: 'text',
    kinds: [...ALL_SYMBOLS, 'graphic'],
    help: 'The name that identifies it ("2nd Bn", "OBJ LION")'
  },
  { key: 'T1', label: 'Second designation', section: 'labels', input: 'text', kinds: ['graphic'] },
  { key: 'M', label: 'Higher formation', section: 'labels', input: 'text', kinds: ['unit', 'installation'] },
  { key: 'V', label: 'Type', section: 'labels', input: 'text', kinds: ['equipment'] },
  { key: 'C', label: 'Quantity', section: 'labels', input: 'number', kinds: ['equipment'] },
  {
    key: 'H',
    label: 'Additional information',
    section: 'labels',
    input: 'text',
    kinds: [...ALL_SYMBOLS, 'graphic']
  },
  {
    key: 'G',
    label: 'Staff comments',
    section: 'labels',
    input: 'textarea',
    kinds: [...ALL_SYMBOLS, 'graphic']
  },
  // Assessment
  {
    key: 'F',
    label: 'Reinforced / reduced',
    section: 'assessment',
    input: 'text',
    kinds: ['unit'],
    help: '+ reinforced, − reduced, ± both'
  },
  {
    key: 'J',
    label: 'Evaluation rating',
    section: 'assessment',
    input: 'rating',
    kinds: ALL_SYMBOLS,
    help: 'Reliability of the source (A–F) and credibility of the information (1–6)'
  },
  {
    key: 'K',
    label: 'Combat effectiveness',
    section: 'assessment',
    input: 'text',
    kinds: ['unit', 'equipment', 'installation', 'activity']
  },
  // Time
  { key: 'W', label: 'Date-time group', section: 'time', input: 'datetime', kinds: ALL_SYMBOLS },
  { key: 'W', label: 'Effective from', section: 'time', input: 'datetime', kinds: ['graphic'] },
  { key: 'W1', label: 'Effective to', section: 'time', input: 'datetime', kinds: ['graphic'] },
  // Movement
  {
    key: 'Q',
    label: 'Direction of movement',
    section: 'movement',
    input: 'number',
    unit: '°',
    kinds: ['unit', 'equipment', 'activity']
  },
  {
    key: 'Z',
    label: 'Speed',
    section: 'movement',
    input: 'number',
    unit: 'km/h',
    kinds: ['unit', 'equipment', 'activity']
  },
  // Geometry (graphics)
  {
    key: 'X',
    label: 'Altitude / depth',
    section: 'geometry',
    input: 'text',
    kinds: ['graphic'],
    help: 'One value, or "min,max" for airspace'
  },
  {
    key: 'AM',
    label: 'Width / radius / length',
    section: 'geometry',
    input: 'text',
    unit: 'm',
    kinds: ['graphic'],
    help: 'For corridors, circles and rectangles'
  },
  { key: 'AN', label: 'Attitude', section: 'geometry', input: 'number', unit: '°', kinds: ['graphic'] }
]

export const SECTIONS: [Field['section'], string][] = [
  ['labels', 'Labels'],
  ['assessment', 'Assessment'],
  ['time', 'Time'],
  ['movement', 'Movement'],
  ['geometry', 'Geometry']
]

/** The fields of a kind of symbol, in order. */
export function fieldsFor(kind: SymbolKind): Field[] {
  return FIELDS.filter((f) => f.kinds.includes(kind))
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** A date (UTC) as a military date-time group: DDHHMMZMONYY ("301200ZOCT26"). */
export function toDtg(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return (
    two(date.getUTCDate()) +
    two(date.getUTCHours()) +
    two(date.getUTCMinutes()) +
    'Z' +
    MONTHS[date.getUTCMonth()] +
    two(date.getUTCFullYear() % 100)
  )
}

/** A date-time group back to a date (UTC), or null if it isn't one. */
export function fromDtg(dtg: string): Date | null {
  const m = /^(\d{2})(\d{2})(\d{2})Z([A-Z]{3})(\d{2})$/.exec(dtg.trim().toUpperCase())
  if (!m) return null
  const month = MONTHS.indexOf(m[4])
  if (month < 0) return null
  const date = new Date(Date.UTC(2000 + Number(m[5]), month, Number(m[1]), Number(m[2]), Number(m[3])))
  return date.getUTCDate() === Number(m[1]) ? date : null
}

/** The modifiers to draw: empty values dropped. */
export function cleanModifiers(modifiers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(modifiers ?? {})) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim()
  }
  return out
}

/** How much of the labels the map shows (a map setting). */
export type LabelLevel = 'none' | 'name' | 'all'

/** The modifiers drawn at a label level: none, the designation only, or everything. */
export function modifiersToDraw(modifiers: Record<string, string> | undefined, level: LabelLevel) {
  const clean = cleanModifiers(modifiers)
  if (level === 'none') return {}
  if (level === 'name') return clean['T'] ? { T: clean['T'] } : {}
  return clean
}

// --- The item card (editor.ts): fields grouped by the question they answer -------

export type Group = 'who' | 'what' | 'when' | 'where' | 'sure'

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

/** The fields of a kind on the card: the defaults, then the ones it has (even blank:
 * just added with "+ Add detail"), in field order. */
export function cardFields(kind: SymbolKind, modifiers: Record<string, string> | undefined): Field[] {
  const shown = new Set([...DEFAULT_FIELDS[kind], ...Object.keys(modifiers ?? {})])
  return fieldsFor(kind).filter((f) => shown.has(f.key))
}

/** The fields that can still be added ("+ Add detail"), by group. */
export function addableFields(
  kind: SymbolKind,
  modifiers: Record<string, string> | undefined
): [Group, Field[]][] {
  const shown = new Set(cardFields(kind, modifiers).map((f) => f.key))
  const out: [Group, Field[]][] = []
  for (const [group] of GROUPS) {
    const fields = fieldsFor(kind).filter((f) => FIELD_GROUP[f.key] === group && !shown.has(f.key))
    if (fields.length) out.push([group, fields])
  }
  return out
}

const RELIABILITY: Record<string, string> = {
  A: 'completely reliable',
  B: 'usually reliable',
  C: 'fairly reliable',
  D: 'not usually reliable',
  E: 'unreliable',
  F: 'reliability unknown'
}
const CREDIBILITY: Record<string, string> = {
  '1': 'confirmed',
  '2': 'probably true',
  '3': 'possibly true',
  '4': 'doubtful',
  '5': 'improbable',
  '6': 'truth unknown'
}

/** A source rating in words: "B2" -> "B2: usually reliable, probably true". */
export function ratingText(rating: string): string {
  const r = RELIABILITY[rating[0]?.toUpperCase()]
  const c = CREDIBILITY[rating[1]]
  if (!r && !c) return rating
  return `${rating.toUpperCase()}: ${[r, c].filter(Boolean).join(', ')}`
}

/** Degrees as a compass point: 45 -> "NE (45°)". */
export function compassText(degrees: string): string {
  const d = Number(degrees)
  if (!Number.isFinite(d)) return degrees
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const point = points[Math.round((((d % 360) + 360) % 360) / 45) % 8]
  return `${point} (${Math.round(d)}°)`
}

/** How long ago (or ahead) a date is, roughly: "2 h ago", "in 3 days", "just now". */
export function relativeTime(date: Date, now = new Date()): string {
  const seconds = (now.getTime() - date.getTime()) / 1000
  const ahead = seconds < 0
  const s = Math.abs(seconds)
  const [value, unit] =
    s < 60
      ? [0, '']
      : s < 3600
        ? [Math.round(s / 60), 'min']
        : s < 86400
          ? [Math.round(s / 3600), 'h']
          : [Math.round(s / 86400), Math.round(s / 86400) === 1 ? 'day' : 'days']
  if (!unit) return 'just now'
  return ahead ? `in ${value} ${unit}` : `${value} ${unit} ago`
}

/** A date-time group for reading: "30 Oct 2026 12:00 · 2 h ago" (local time). */
export function dtgText(dtg: string, now = new Date()): string {
  const date = fromDtg(dtg)
  if (!date) return dtg
  const when = date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
  return `${when} · ${relativeTime(date, now)}`
}

/** A field's value as shown on the card. */
export function displayValue(key: string, value: string, now = new Date()): string {
  if (!value) return ''
  if (key === 'W' || key === 'W1') return dtgText(value, now)
  if (key === 'J') return ratingText(value)
  if (key === 'Q') return compassText(value)
  if (key === 'Z') return `${value} km/h`
  if (key === 'F')
    return value === '+'
      ? 'Reinforced (+)'
      : value === '-' || value === '−'
        ? 'Reduced (−)'
        : value === '±'
          ? 'Reinforced and reduced (±)'
          : value
  return value
}
