import { describe, expect, test } from 'vitest'
import {
  addableFields,
  cardFields,
  cleanModifiers,
  compassText,
  displayValue,
  dtgText,
  fieldsFor,
  fromDtg,
  modifiersToDraw,
  ratingText,
  relativeTime,
  toDtg
} from './fields.ts'

describe('date-time groups', () => {
  test('a date as DDHHMMZMONYY', () => {
    expect(toDtg(new Date(Date.UTC(2026, 9, 30, 12, 5)))).toBe('301205ZOCT26')
    expect(toDtg(new Date(Date.UTC(2027, 0, 1, 0, 0)))).toBe('010000ZJAN27')
  })

  test('read back', () => {
    const date = new Date(Date.UTC(2026, 9, 30, 12, 5))
    expect(fromDtg(toDtg(date))?.getTime()).toBe(date.getTime())
    expect(fromDtg(' 301205zoct26 ')?.getTime()).toBe(date.getTime())
  })

  test.each(['', '301205OCT26', '301205ZXXX26', '311205ZNOV26', 'hello'])('%s is not one', (value) => {
    expect(fromDtg(value)).toBeNull()
  })
})

describe('fields per kind of symbol', () => {
  const keys = (kind: Parameters<typeof fieldsFor>[0]) => fieldsFor(kind).map((f) => f.key)

  test('units have a higher formation and movement, not a type', () => {
    expect(keys('unit')).toEqual(expect.arrayContaining(['T', 'M', 'H', 'G', 'F', 'J', 'W', 'Q', 'Z']))
    expect(keys('unit')).not.toContain('V')
  })

  test('equipment has a type and quantity, not a higher formation', () => {
    expect(keys('equipment')).toEqual(expect.arrayContaining(['V', 'C']))
    expect(keys('equipment')).not.toContain('M')
  })

  test('graphics have effective times and geometry, no rating', () => {
    expect(keys('graphic')).toEqual(expect.arrayContaining(['T', 'T1', 'W', 'W1', 'X', 'AM', 'AN']))
    expect(keys('graphic')).not.toContain('J')
    // W is "effective from" for graphics, not the date-time group.
    expect(fieldsFor('graphic').find((f) => f.key === 'W')?.label).toBe('Effective from')
  })
})

describe('modifiers drawn on the map', () => {
  const modifiers = { T: ' 2nd Bn ', M: '1st Bde', H: '', G: '  ' }

  test('empty values dropped and trimmed', () => {
    expect(cleanModifiers(modifiers)).toEqual({ T: '2nd Bn', M: '1st Bde' })
    expect(cleanModifiers(undefined)).toEqual({})
  })

  test('by label level', () => {
    expect(modifiersToDraw(modifiers, 'none')).toEqual({})
    expect(modifiersToDraw(modifiers, 'name')).toEqual({ T: '2nd Bn' })
    expect(modifiersToDraw({ M: '1st Bde' }, 'name')).toEqual({})
    expect(modifiersToDraw(modifiers, 'all')).toEqual({ T: '2nd Bn', M: '1st Bde' })
  })
})

describe('the item card', () => {
  test('default details per kind, plus any the item has (even just added, blank)', () => {
    const keys = (kind: Parameters<typeof cardFields>[0], m?: Record<string, string>) =>
      cardFields(kind, m).map((f) => f.key)
    expect(keys('unit')).toEqual(['T', 'M', 'W'])
    expect(keys('equipment')).toEqual(['T', 'V', 'C', 'W'])
    expect(keys('graphic')).toEqual(['T', 'W', 'W1'])
    expect(keys('unit', { Z: ' ' })).toEqual(['T', 'M', 'W', 'Z'])
    expect(keys('unit', { Q: '45' })).toContain('Q')
  })

  test('what can still be added, grouped by question', () => {
    const groups = addableFields('unit', {})
    expect(groups.map(([g]) => g)).toEqual(['what', 'where', 'sure'])
    expect(groups.flatMap(([, fields]) => fields.map((f) => f.key))).not.toContain('M')
    expect(addableFields('unit', { Q: '1', Z: '2' }).find(([g]) => g === 'where')).toBeUndefined()
  })

  test('values in words', () => {
    expect(ratingText('B2')).toBe('B2: usually reliable, probably true')
    expect(ratingText('a1')).toBe('A1: completely reliable, confirmed')
    expect(ratingText('??')).toBe('??')
    expect(compassText('45')).toBe('NE (45°)')
    expect(compassText('359')).toBe('N (359°)')
    expect(compassText('-90')).toBe('W (-90°)')
    expect(displayValue('Z', '20')).toBe('20 km/h')
    expect(displayValue('F', '+')).toBe('Reinforced (+)')
    expect(displayValue('T', '2nd Bn')).toBe('2nd Bn')
  })

  test('relative times', () => {
    const now = new Date(Date.UTC(2026, 9, 30, 12, 0))
    const ago = (ms: number) => relativeTime(new Date(now.getTime() - ms), now)
    expect(ago(20_000)).toBe('just now')
    expect(ago(5 * 60_000)).toBe('5 min ago')
    expect(ago(2 * 3_600_000)).toBe('2 h ago')
    expect(ago(86_400_000)).toBe('1 day ago')
    expect(ago(-3 * 86_400_000)).toBe('in 3 days')
    expect(dtgText('301000ZOCT26', now)).toMatch(/2 h ago$/)
    expect(dtgText('nonsense', now)).toBe('nonsense')
  })
})
