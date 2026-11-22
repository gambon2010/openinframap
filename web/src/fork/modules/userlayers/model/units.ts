// Fork: the units a detail's value is given in (the item card's details, fields.ts).
// A speed, distance or altitude is a label on the symbol: it's kept as written, with
// its unit ("30 kn"), and drawn so. A direction turns the symbol's arrow: it's kept
// in degrees, and shown in the unit chosen. The unit chosen last for a detail is
// kept in this browser, so the next one starts in it.
import { readText, writeText } from '../../../core/storage.ts'
import type { AllowedRange, Quantity, RangeProblem, Unit } from './units.types.ts'
import { UNITS } from './units.constants.ts'

/** A value kept with its unit, split: the number part as written ("30", "100,500")
 * and its unit (the quantity's first when it has none written: how it was kept before
 * units could be chosen). */
export function splitValue(value: string, quantity: Quantity): { amount: string; unit: Unit } {
  const trimmed = value.trim()
  const units = UNITS[quantity]
  // Longest symbols first: "km" before "m".
  const bySymbol = [...units].sort((a, b) => b.symbol.length - a.symbol.length)
  const unit = bySymbol.find((u) => trimmed.endsWith(u.symbol))
  if (!unit) return { amount: trimmed, unit: units[0] }
  return { amount: trimmed.slice(0, -unit.symbol.length).trim(), unit }
}

/** A value to keep with its unit: "30 kn" (nothing when there's no amount). */
export function joinValue(amount: string, unit: Unit): string {
  const trimmed = amount.trim()
  return trimmed ? `${trimmed} ${unit.symbol}` : ''
}

/** An angle kept in degrees, in a unit (rounded to a tenth). */
export function angleIn(degrees: number, unit: Unit): number {
  return Math.round((degrees / unit.factor) * 10) / 10
}

/** An angle given in a unit, in degrees, as kept (rounded to a tenth). */
export function angleFrom(amount: number, unit: Unit): number {
  return Math.round(amount * unit.factor * 10) / 10
}

/** What's wrong with an amount typed in a unit, if anything: each number in it (one,
 * or "min,max") must be a number within the range allowed, given in the quantity's
 * first unit (a negative speed is no speed). Empty is fine: nothing is kept. */
export function rangeProblem(amount: string, unit: Unit, range: AllowedRange): RangeProblem | null {
  const parts = amount.split(',').map((part) => part.trim())
  if (amount.trim() === '') return null
  for (const part of parts) {
    const value = Number(part)
    if (part === '' || !Number.isFinite(value)) return 'not-a-number'
    const inFirstUnit = value * unit.factor
    if (range.min !== undefined && inFirstUnit < range.min) return 'too-low'
    if (range.max !== undefined && inFirstUnit > range.max) return 'too-high'
  }
  return null
}

/** The unit a detail was last given in, in this browser (else its quantity's first). */
export function lastUnit(key: string, quantity: Quantity): Unit {
  const symbol = readText(storageKey(key))
  return UNITS[quantity].find((u) => u.symbol === symbol) ?? UNITS[quantity][0]
}

/** Remembers the unit a detail was given in, for the next one. */
export function rememberUnit(key: string, unit: Unit) {
  writeText(storageKey(key), unit.symbol)
}

function storageKey(key: string): string {
  return `oim-userlayers-unit-${key}`
}
