import { describe, expect, test } from 'vitest'
import { UserFeature } from '../../model/model.ts'
import { groupItems, groupOf } from './groups.ts'

let n = 0
function item(
  properties: UserFeature['properties'],
  geometry: GeoJSON.Geometry = { type: 'Point', coordinates: [0, 0] }
): UserFeature {
  return { type: 'Feature', id: `f${n++}`, geometry, properties }
}
const line: GeoJSON.Geometry = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [1, 1]
  ]
}
const area: GeoJSON.Geometry = {
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

describe("a layer's items, grouped", () => {
  test('by side and kind', () => {
    expect(groupOf(item({ kind: 'symbol', sidc: 'SFGPUCI--------' }))).toBe('friendly-units')
    expect(groupOf(item({ kind: 'symbol', sidc: 'SAGPUCI--------' }))).toBe('friendly-units') // assumed friend
    expect(groupOf(item({ kind: 'symbol', sidc: 'SSGPUCI--------' }))).toBe('hostile-units') // suspect
    expect(groupOf(item({ kind: 'symbol', sidc: 'SUGPUCI--------' }))).toBe('other-units')
    expect(groupOf(item({ kind: 'graphic', sidc: 'GHGPOLAGM------' }, line))).toBe('hostile-graphics')
    expect(groupOf(item({ kind: 'measure', measure: 'distance' }, line))).toBe('measurements')
    expect(groupOf(item({ kind: 'drawing' }, line))).toBe('drawings')
    expect(groupOf(item({ kind: 'marker' }))).toBe('drawings')
    expect(groupOf(item({ kind: 'image', image: 'x' }))).toBe('pictures')
  })

  test('groups in their order, empty ones left out', () => {
    const groups = groupItems([
      item({ kind: 'measure', measure: 'distance' }, line),
      item({ kind: 'graphic', sidc: 'GHGPOLAGM------' }, line),
      item({ kind: 'symbol', sidc: 'SHGPUCI--------' }),
      item({ kind: 'graphic', sidc: 'GFGPOLAGM------' }, line),
      item({ kind: 'symbol', sidc: 'SFGPUCI--------' })
    ]).map(([g]) => g)
    // By side: friendly units and graphics, then hostile ones.
    expect(groups).toEqual([
      'friendly-units',
      'friendly-graphics',
      'hostile-units',
      'hostile-graphics',
      'measurements'
    ])
  })

  test('inside a group: present before planned, then arrows, lines, areas, then type, then name', () => {
    const graphic = (
      name: string,
      geometry: GeoJSON.Geometry,
      extra: Partial<UserFeature['properties']> = {},
      planned = false
    ) =>
      item(
        { kind: 'graphic', sidc: planned ? 'GFGAOLAGM------' : 'GFGPOLAGM------', name, ...extra },
        geometry
      )
    const items = [
      graphic('Zone', area),
      graphic('Planned arrow', line, { axis: true }, true),
      graphic('Phase B', line),
      graphic('Phase A', line),
      graphic('Arrow 10', line, { axis: true }),
      graphic('Arrow 2', line, { axis: true })
    ]
    const [[, sorted]] = groupItems(items)
    expect(sorted.map((f) => f.properties.name)).toEqual([
      'Arrow 2', // arrows first, numbers in order
      'Arrow 10',
      'Phase A', // then lines
      'Phase B',
      'Zone', // then areas
      'Planned arrow' // planned at the end
    ])
  })
})
