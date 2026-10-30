import { beforeEach, describe, expect, test } from 'vitest'
import {
  catalogueCode,
  concreteSidc,
  entryOf,
  groupsFor,
  rememberRecent,
  searchCatalogue,
  symbolName
} from './palette.ts'
import catalogue from './symbols-2525c.json'

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
    expect(searchCatalogue('', 'graphics').length).toBeGreaterThan(200)
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

  test('groups per mode', () => {
    expect(groupsFor('graphics')).toContain('Tasks')
    expect(groupsFor('graphics')).not.toContain('Ground units')
    expect(groupsFor('symbols')).toContain('Ground units')
  })
})

describe('recently used', () => {
  beforeEach(() => localStorage.clear())

  test('most recent first, no repeats, at most 12', () => {
    let recent: string[] = []
    for (let i = 0; i < 14; i++) recent = rememberRecent(`code${i}`, recent)
    recent = rememberRecent('code5', recent)
    expect(recent[0]).toBe('code5')
    expect(recent).toHaveLength(12)
    expect(new Set(recent).size).toBe(12)
    expect(JSON.parse(localStorage.getItem('oim-userlayers-recent')!)).toEqual(recent)
  })
})
