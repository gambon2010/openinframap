import { describe, expect, test } from 'vitest'
import { byFloor, firstLevel, itemLabel, whatOf } from './inside.ts'
import type { InsideItem } from './indoor.types.ts'

const item = (name: string | null, levels: string | null, what = 'shop'): InsideItem => ({
  name,
  what,
  levels,
  at: [0, 0]
})

describe("what's inside a building", () => {
  test('listed under the first floor its level names', () => {
    expect(firstLevel(item('a', '1;2'))).toBe(1)
    expect(firstLevel(item('a', '0-3'))).toBe(0)
    expect(firstLevel(item('a', '-2--1'))).toBe(-2)
    expect(firstLevel(item('a', '0.5'))).toBe(0.5)
    expect(firstLevel(item('a', null))).toBeNull()
    expect(firstLevel(item('a', 'ground'))).toBeNull()
  })

  test('by floor from the lowest, names in order, floor not given last', () => {
    const groups = byFloor([item('Relay', '0'), item('Paul', null), item('Lift', '-1'), item('Bar', '0')])
    expect(groups.map((g) => [g.level, g.lines.map((l) => l.item.name)])).toEqual([
      [-1, ['Lift']],
      [0, ['Bar', 'Relay']],
      [null, ['Paul']]
    ])
  })

  test('nothing inside: no groups', () => {
    expect(byFloor([])).toEqual([])
  })
})

describe('a line of the list', () => {
  test('its name; with none, what it is, readable', () => {
    expect(itemLabel(item('Relay', '0'))).toBe('Relay')
    expect(itemLabel(item(null, '0', 'fast_food'))).toBe('fast food')
  })
})

describe('lines alike', () => {
  test('one line with how many', () => {
    const [ground] = byFloor([item('Gares', '-3', 'poi'), item('Gares', '-3', 'poi'), item('Paul', '-3')])
    expect(ground.lines.map((l) => [l.item.name, l.count])).toEqual([
      ['Gares', 2],
      ['Paul', 1]
    ])
  })

  test('what it is shown when known', () => {
    expect(whatOf(item('Paul', '0', 'bakery'))).toBe('bakery')
    expect(whatOf(item('Gares', '0', 'poi'))).toBeNull()
    expect(whatOf(item(null, '0', 'toilets'))).toBeNull()
  })
})
