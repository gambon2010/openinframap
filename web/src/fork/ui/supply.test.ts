import { expect, test } from 'vitest'
import { supplyColours } from './supply.ts'

test('supply colours for map features and their copies', () => {
  expect(supplyColours.of('power_line', 1)).toBeNull() // off
  supplyColours.set(true, { 'power_line:1': 'red', 'power_substation:7': 'orange' })
  expect(supplyColours.of('power_line', 1)).toBe('red')
  expect(supplyColours.of('power_line', 2)).toBe('green')
  expect(supplyColours.of('power_substation_point', 7)).toBe('orange')
  expect(supplyColours.of('sites_point', 7)).toBeNull()
  supplyColours.set(false)
  expect(supplyColours.of('power_line', 1)).toBeNull()
})
