import { describe, expect, it } from 'vitest'
import { FeatureState, featureFields, featureFromFields, mergeFeature, mergeLayer } from './merge.ts'

const item = (props: Record<string, unknown>, coords = [7, 48], layerId = 'L'): FeatureState => ({
  layerId,
  feature: {
    type: 'Feature',
    id: 'f',
    geometry: { type: 'Point', coordinates: coords },
    properties: { kind: 'symbol', ...props }
  }
})

const SIDC = 'SFGPUCI----D---'

describe('merging an item field by field', () => {
  const base = item({ name: 'Alpha', sidc: SIDC, modifiers: { T: '1', H: 'x' } })

  it('takes theirs where only they changed, keeps yours where only you did', () => {
    const mine = item({ name: 'Alpha', sidc: SIDC, modifiers: { T: '1', H: 'x' } }, [8, 49]) // moved
    const theirs = item({ name: 'Bravo', sidc: SIDC, modifiers: { T: '1', H: 'x' } }) // renamed
    const { merged, conflicts } = mergeFeature('f', base, mine, theirs)
    expect(conflicts).toEqual([])
    expect(merged!.feature.properties.name).toBe('Bravo')
    expect(merged!.feature.geometry).toEqual({ type: 'Point', coordinates: [8, 49] })
  })

  it('merges the parts of the symbol code and each detail on their own', () => {
    const mine = item({ name: 'Alpha', sidc: 'SHGPUCI----D---', modifiers: { T: '2', H: 'x' } }) // hostile, T
    const theirs = item({ name: 'Alpha', sidc: 'SFGAUCI----D---', modifiers: { T: '1', H: 'y' } }) // anticipated, H
    const { merged, conflicts } = mergeFeature('f', base, mine, theirs)
    expect(conflicts).toEqual([])
    expect(merged!.feature.properties.sidc).toBe('SHGAUCI----D---')
    expect(merged!.feature.properties.modifiers).toEqual({ T: '2', H: 'y' })
  })

  it('a field both changed differently is a conflict, yours kept until resolved', () => {
    const mine = item({ name: 'Charlie', sidc: SIDC, modifiers: { T: '1', H: 'x' } })
    const theirs = item({ name: 'Bravo', sidc: SIDC, modifiers: { T: '1', H: 'x' } })
    const { merged, conflicts } = mergeFeature('f', base, mine, theirs)
    expect(conflicts).toEqual(['properties.name'])
    expect(merged!.feature.properties.name).toBe('Charlie')
    // Both to the same value: nothing to do.
    expect(mergeFeature('f', base, theirs, theirs).conflicts).toEqual([])
  })

  it('deleted on one side and changed on the other is a conflict; deleted unchanged, deleted', () => {
    const changed = item({ name: 'Bravo', sidc: SIDC, modifiers: { T: '1', H: 'x' } })
    expect(mergeFeature('f', base, null, changed).conflicts).toEqual(['deleted'])
    expect(mergeFeature('f', base, changed, null).conflicts).toEqual(['deleted'])
    expect(mergeFeature('f', base, null, base)).toEqual({ merged: null, conflicts: [] })
    expect(mergeFeature('f', base, base, null)).toEqual({ merged: null, conflicts: [] })
    expect(mergeFeature('f', base, null, null)).toEqual({ merged: null, conflicts: [] })
  })

  it('moved to another layer is one more field', () => {
    const moved = item({ name: 'Alpha', sidc: SIDC, modifiers: { T: '1', H: 'x' } }, [7, 48], 'M')
    const renamed = item({ name: 'Bravo', sidc: SIDC, modifiers: { T: '1', H: 'x' } })
    const { merged } = mergeFeature('f', base, moved, renamed)
    expect(merged!.layerId).toBe('M')
    expect(merged!.feature.properties.name).toBe('Bravo')
  })

  it('fields go back into an item unchanged', () => {
    expect(featureFromFields('f', featureFields(base))).toEqual(base)
  })
})

describe('merging a layer', () => {
  const base = { name: 'Units', style: { folder: 'A' } }
  it('name and each style key', () => {
    const mine = { name: 'Units', style: { folder: 'B' } }
    const theirs = { name: 'Our units', style: { folder: 'A', locked: true } }
    expect(mergeLayer(base, mine, theirs)).toEqual({
      merged: { name: 'Our units', style: { folder: 'B', locked: true } },
      conflicts: []
    })
    expect(mergeLayer(base, { name: 'A', style: {} }, { name: 'B', style: {} }).conflicts).toContain('name')
  })
})
