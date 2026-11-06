import { describe, expect, test, vi } from 'vitest'
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

describe('storage', () => {
  test('text and JSON, with their fallbacks', async () => {
    const { readJson, readText, writeJson, writeText } = await import('./storage.ts')
    localStorage.clear()
    expect(readText('a')).toBeNull()
    writeText('a', '1')
    expect(readText('a')).toBe('1')
    expect(readJson('b', ['x'])).toEqual(['x'])
    writeJson('b', { n: 2 })
    expect(readJson('b', null)).toEqual({ n: 2 })
    writeText('c', 'not json')
    expect(readJson('c', 7)).toBe(7)
  })

  test('blocked storage: the fallback, and writing does nothing', async () => {
    const { readJson, readText, writeText } = await import('./storage.ts')
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      expect(readText('a')).toBeNull()
      expect(readJson('a', 'fallback')).toBe('fallback')
      expect(() => writeText('a', '1')).not.toThrow()
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })
})

describe('distance on the ground', () => {
  test('Strasbourg to Kehl, and the same everywhere (not stretched by latitude)', async () => {
    const { groundDistance } = await import('./geo.ts')
    expect(groundDistance([7.75, 48.58], [7.81, 48.58]) / 1000).toBeCloseTo(4.42, 1)
    // 0.05° of longitude: 5.6 km at the equator, 2.8 km at 60°N.
    expect(groundDistance([0, 0], [0.05, 0]) / 1000).toBeCloseTo(5.56, 1)
    expect(groundDistance([0, 60], [0.05, 60]) / 1000).toBeCloseTo(2.78, 1)
  })
})
