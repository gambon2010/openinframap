// Fork: the descriptive fields of a symbol (MIL-STD-2525C text modifiers, as ODIN
// shows them), by kind of symbol. They're stored in the feature's properties as
// `modifiers` ({T: "2nd Bn", W: "301200ZOCT26"...}) and drawn around the symbol.
// Identity, status, echelon and mobility live in the code itself (sidc.ts).
import { SymbolKind } from './sidc.ts'
import type { Field, LabelLevel, Group } from './fields.types.ts'
import {
  FIELDS,
  MONTHS,
  GROUPS,
  FIELD_GROUP,
  DEFAULT_FIELDS,
  RELIABILITY,
  CREDIBILITY
} from './fields.constants.ts'

/** The fields of a kind of symbol, in order. */
export function fieldsFor(kind: SymbolKind): Field[] {
  return FIELDS.filter((f) => f.kinds.includes(kind))
}

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

/** The modifiers drawn at a label level: none, the designation only, or everything. */
export function modifiersToDraw(modifiers: Record<string, string> | undefined, level: LabelLevel) {
  const clean = cleanModifiers(modifiers)
  if (level === 'none') return {}
  if (level === 'name') return clean['T'] ? { T: clean['T'] } : {}
  return clean
}

// --- The item card (editor.ts): fields grouped by the question they answer -------

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
