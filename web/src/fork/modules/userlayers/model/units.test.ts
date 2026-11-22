import { beforeEach, describe, expect, test } from 'vitest'
import { UNITS } from './units.constants.ts'
import { angleFrom, angleIn, joinValue, lastUnit, rememberUnit, splitValue } from './units.ts'

const unit = (quantity: keyof typeof UNITS, symbol: string) =>
  UNITS[quantity].find((u) => u.symbol === symbol)!

describe("a detail's units", () => {
  beforeEach(() => localStorage.clear())

  test('a value kept with its unit splits back into amount and unit', () => {
    expect(splitValue('30 kn', 'speed')).toEqual({ amount: '30', unit: unit('speed', 'kn') })
    // "km" isn't read as "m" with a "k" left over.
    expect(splitValue('5 km', 'distance')).toEqual({ amount: '5', unit: unit('distance', 'km') })
    expect(splitValue('100,500 ft', 'altitude').amount).toBe('100,500')
  })

  test('a value kept before units could be chosen is in the first unit', () => {
    expect(splitValue('30', 'speed')).toEqual({ amount: '30', unit: unit('speed', 'km/h') })
    expect(splitValue('', 'speed').amount).toBe('')
  })

  test('kept as written, with its unit; nothing when there is no amount', () => {
    expect(joinValue(' 30 ', unit('speed', 'kn'))).toBe('30 kn')
    expect(joinValue('  ', unit('speed', 'kn'))).toBe('')
  })

  test('a direction kept in degrees, shown in mils and back (6400 to a turn)', () => {
    const mils = unit('angle', 'mils')
    expect(angleIn(90, mils)).toBe(1600)
    expect(angleFrom(1600, mils)).toBe(90)
    expect(angleIn(359.9, unit('angle', '°'))).toBe(359.9)
  })

  test("a detail's last unit is remembered for the next one", () => {
    expect(lastUnit('Z', 'speed').symbol).toBe('km/h')
    rememberUnit('Z', unit('speed', 'kn'))
    expect(lastUnit('Z', 'speed').symbol).toBe('kn')
    // Another detail keeps its own.
    expect(lastUnit('AM', 'distance').symbol).toBe('m')
  })
})
