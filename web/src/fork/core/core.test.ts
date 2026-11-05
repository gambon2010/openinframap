import { describe, expect, test } from 'vitest'
import { metresPerPixel, toDegrees, toRadians } from './geo.ts'
import { clamp } from './math.ts'
import { parseHex } from './colour.ts'
import { geometryIs } from './map-style.ts'

describe('core helpers', () => {
  test('degrees and radians', () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 12)
    expect(toDegrees(Math.PI / 2)).toBeCloseTo(90, 12)
  })

  test('metres per pixel: as before (about 0.3 m at zoom 18 on the equator)', () => {
    expect(metresPerPixel(0, 18)).toBeCloseTo(0.2986, 3)
    expect(metresPerPixel(48.58, 13)).toBe(6.321090600788651)
  })

  test('clamp: no rounding', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-1, 0, 1)).toBe(0)
    expect(clamp(0.123456, 0, 1)).toBe(0.123456)
  })

  test('hex colours', () => {
    expect(parseHex('#d32f2f')).toEqual([211, 47, 47])
    expect(parseHex('D32F2F')).toEqual([211, 47, 47])
    expect(parseHex('red')).toBeNull()
  })

  test('geometry filters', () => {
    expect(geometryIs('Point', 'MultiPoint')).toEqual([
      'in',
      ['geometry-type'],
      ['literal', ['Point', 'MultiPoint']]
    ])
  })
})
