import { describe, expect, test } from 'vitest'
import {
  catalogueCode,
  concreteSidc,
  entryOf,
  CATEGORIES,
  categoriesFor,
  searchCatalogue,
  symbolName
} from './palette.ts'
import catalogue from '../model/symbols-2525c.json'

describe('codes', () => {
  test('identity and status filled in, and taken out again', () => {
    expect(concreteSidc('S*G*UCI--------', 'H', 'A')).toBe('SHGAUCI--------')
    // Fixed identity or status in the catalogue stays.
    expect(concreteSidc('EFIPAA---------', 'H', 'A')).toBe('EFIPAA---------')
    expect(catalogueCode('SHGAUCI----F---')).toBe('S*G*UCI---')
  })

  test('a concrete code finds its catalogue entry, whatever its modifiers', () => {
    expect(symbolName('SHGAUCI----F---')).toBe('Infantry')
    expect(entryOf('GFGPOLAGM------')?.[3]).toBe('L')
    expect(symbolName('SFGPZZZZZZ-----')).toBeUndefined()
  })
})

describe('the catalogue', () => {
  test('codes are 15 characters and unique', () => {
    const codes = catalogue.groups.flatMap((g) => g.symbols.map((s) => s[0] as string))
    expect(codes.every((c) => c.length === 15)).toBe(true)
    expect(new Set(codes).size).toBe(codes.length)
  })

  test('has symbols and tactical graphics', () => {
    expect(searchCatalogue('', 'symbols').length).toBeGreaterThan(1400)
    // 216 in the source, less the 17 rectangular ones (need a width: removed).
    expect(searchCatalogue('', 'graphics').length).toBeGreaterThan(190)
  })
})

describe('search', () => {
  test('every word must match, any order, any case', () => {
    const names = searchCatalogue('ATTACK main', 'graphics').map((e) => e[1])
    expect(names).toContain('Main attack')
    expect(names.every((n) => /main/i.test(n) && /attack/i.test(n))).toBe(true)
  })

  test('symbols and graphics are kept apart', () => {
    expect(searchCatalogue('phase line', 'symbols')).toEqual([])
    expect(searchCatalogue('phase line', 'graphics').map((e) => e[1])).toContain('Phase line')
  })

  test('within a group', () => {
    const tasks = searchCatalogue('', 'graphics', 'Tasks')
    expect(tasks.length).toBeGreaterThan(10)
    expect(tasks.every((e) => e[0].startsWith('G*T*'))).toBe(true)
  })

  test('categories per mode, in plain words', () => {
    expect(categoriesFor('graphics')).toEqual(
      expect.arrayContaining(['Arrows', 'Tasks', 'Lines', 'Areas', 'Obstacles'])
    )
    expect(categoriesFor('symbols')).toEqual(expect.arrayContaining(['Units', 'Incidents and emergencies']))
    expect(searchCatalogue('', 'graphics', 'Arrows').map((e) => e[1])).toContain('Main attack')
    expect(searchCatalogue('', 'graphics', 'Lines').map((e) => e[1])).toContain('Phase line')
    expect(searchCatalogue('', 'graphics', 'Lines').map((e) => e[1])).not.toContain('Main attack')
  })

  test('every symbol and graphic is in at least one category', () => {
    for (const mode of ['symbols', 'graphics'] as const) {
      const inSome = new Set(
        CATEGORIES.filter((c) => c.mode === mode).flatMap((c) =>
          searchCatalogue('', mode, c.label).map((e) => e[0])
        )
      )
      const missing = searchCatalogue('', mode).filter((e) => !inSome.has(e[0]))
      expect(missing.map((e) => e[1])).toEqual([])
    }
  })
})
