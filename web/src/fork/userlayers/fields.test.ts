import { describe, expect, test } from 'vitest'
import { cleanModifiers, fieldsFor, fromDtg, modifiersToDraw, toDtg } from './fields.ts'

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
