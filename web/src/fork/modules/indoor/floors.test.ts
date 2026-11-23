import { describe, expect, test } from 'vitest'
import { floorFilter, floorName, withFloor } from './floors.ts'

describe("a building's floors", () => {
  test('nothing chosen: nothing drawn', () => {
    expect(floorFilter(new Map())).toEqual(['boolean', false])
  })

  test('a floor chosen: that building’s pieces spanning it', () => {
    expect(floorFilter(new Map([[42, 1]]))).toEqual([
      'any',
      [
        'all',
        ['==', ['get', 'building_id'], 42],
        ['<=', ['get', 'level_low'], 1],
        ['>=', ['get', 'level_high'], 1]
      ]
    ])
  })

  test('chosen, changed, then hidden', () => {
    let shown = withFloor(new Map(), 42, 0)
    shown = withFloor(shown, 42, 2)
    expect([...shown]).toEqual([[42, 2]])
    expect(withFloor(shown, 42, null).size).toBe(0)
  })

  test('named as people say them', () => {
    const names = { ground: 'Ground floor', floor: 'Floor {{n}}', basement: 'Basement {{n}}' }
    expect(floorName(0, names)).toBe('Ground floor')
    expect(floorName(2, names)).toBe('Floor 2')
    expect(floorName(-1, names)).toBe('Basement 1')
  })
})
