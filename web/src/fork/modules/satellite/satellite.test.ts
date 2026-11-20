import { describe, expect, it, test } from 'vitest'
import { covers, tiersOf } from './tiers.ts'

describe('the imagery list', () => {
  test('tiers, coarsest first, their tiles at the server', () => {
    const tiers = tiersOf(
      [
        {
          file: 'lux.sat-regional',
          format: 'webp',
          minzoom: 9,
          maxzoom: 12,
          bounds: null,
          credit: 'Copernicus'
        },
        { file: 'world.sat-overview', format: 'jpg', minzoom: 0, maxzoom: 8, bounds: null, credit: 'NASA' }
      ],
      'https://h/satellite'
    )
    expect(tiers).toEqual([
      {
        url: 'https://h/satellite/world.sat-overview/{z}/{x}/{y}.jpg',
        minzoom: 0,
        maxzoom: 8,
        attribution: 'NASA'
      },
      {
        url: 'https://h/satellite/lux.sat-regional/{z}/{x}/{y}.webp',
        minzoom: 9,
        maxzoom: 12,
        attribution: 'Copernicus'
      }
    ])
  })

  test('nothing, or broken entries, left out', () => {
    expect(tiersOf(null, 'x')).toEqual([])
    expect(tiersOf({ not: 'a list' }, 'x')).toEqual([])
    expect(tiersOf([{ file: 'a', format: 'jpg', minzoom: 12, maxzoom: 9 }, { format: 'jpg' }], 'x')).toEqual(
      []
    )
  })
})

describe('imagery coverage', () => {
  it('reads the bounds an entry has', () => {
    const [tier] = tiersOf(
      [
        {
          file: 'fr-67',
          format: 'webp',
          minzoom: 14,
          maxzoom: 17,
          bounds: [6.9, 48.1, 8.3, 49.1],
          credit: '© IGN'
        }
      ],
      'x'
    )
    expect(tier.bounds).toEqual([6.9, 48.1, 8.3, 49.1])
  })

  it('is offered only where some imagery is', () => {
    const luxembourg: [number, number, number, number] = [5.73, 49.44, 6.53, 50.18]
    expect(covers([luxembourg], [6, 49.5, 6.2, 49.7])).toBe(true)
    expect(covers([luxembourg], [7.2, 47.7, 7.4, 47.8])).toBe(false)
  })
})
