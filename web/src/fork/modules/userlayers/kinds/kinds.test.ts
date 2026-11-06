import { describe, expect, test } from 'vitest'
import { KINDS, KIND_IDS, kindOf, kindOfImage } from './index.ts'
import { iconName } from '../map/icons.ts'
import { FeatureProps } from '../model/model.ts'

const item = (
  properties: FeatureProps,
  geometry: GeoJSON.Geometry = { type: 'Point', coordinates: [0, 0] }
) => ({
  geometry,
  properties
})

describe('the kinds', () => {
  test('one of each, their images under prefixes of their own', () => {
    expect(new Set(KIND_IDS).size).toBe(KINDS.length)
    const prefixes = KINDS.flatMap((k) => (k.images ? [k.images.prefix] : []))
    expect(new Set(prefixes).size).toBe(prefixes.length)
    // A kind that names icons can draw them.
    for (const kind of KINDS) expect(Boolean(kind.icon)).toBe(Boolean(kind.images))
  })

  test('an unknown kind (from a newer version) is drawn as a drawing', () => {
    expect(kindOf({ kind: 'balloon' as FeatureProps['kind'] }).id).toBe('drawing')
  })

  test('icons: named by the kind, drawn by the kind with that prefix', () => {
    const name = iconName({ kind: 'marker', color: '#123456' })!
    expect(name).toBe('user-marker:#123456')
    // No colour of its own: black.
    expect(iconName({ kind: 'marker' })).toBe('user-marker:#000000')
    expect(kindOfImage(name.split(':')[0])?.id).toBe('marker')
    expect(iconName({ kind: 'drawing' })).toBeNull()
    expect(iconName({ kind: 'image', image: 'abc' })).toBe('userimg:abc')
  })

  test('in words: lines and areas, copies, symbols', () => {
    const line = item(
      { kind: 'drawing' },
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1]
        ]
      }
    )
    const area = item(
      { kind: 'drawing' },
      {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0]
          ]
        ]
      }
    )
    expect(kindOf(line.properties).noun(line)).toBe('line')
    expect(kindOf(area.properties).noun(area)).toBe('area')
    expect(kindOf(area.properties).thumbnail(area)).toBe('▱')
    const copy = item({ kind: 'copy', copy: { source: 's', sourceLayer: 'l', layer: 'Power lines' } })
    expect(kindOf(copy.properties).noun(copy)).toBe('copy of Power lines')
    const unit = item({ kind: 'symbol', sidc: 'SFGPUCI----D---' })
    expect(kindOf(unit.properties).what(unit)).toBe('Infantry')
    // The symbol library isn't loaded yet: no thumbnail until it is.
    expect(kindOf(unit.properties).thumbnail(unit)).toBeNull()
  })

  test("the list's filter chips", () => {
    expect(kindOf({ kind: 'symbol' }).filters?.({ kind: 'symbol', sidc: 'SFGPUCI----D---' })).toEqual([
      'units'
    ])
    expect(kindOf({ kind: 'drawing' }).filters?.({ kind: 'drawing' })).toEqual(['graphics'])
    expect(kindOf({ kind: 'copy' }).filters).toBeUndefined()
  })

  test('what can be done to each', () => {
    expect(kindOf({ kind: 'copy' }).movable).toBe(false)
    expect(
      KINDS.filter((k) => k.sized)
        .map((k) => k.id)
        .sort()
    ).toEqual(['image', 'marker', 'symbol'])
    expect(
      KINDS.filter((k) => k.drawn !== 'standard')
        .map((k) => k.id)
        .sort()
    ).toEqual(['copy', 'graphic', 'measure'])
  })
})
