import { describe, expect, test } from 'vitest'
import { isStatusFeature, switcherLayersFor } from './click.ts'

describe('clicking through a status', () => {
  test('the feature a status is about: same tile layer and id (osm_id or id)', () => {
    const status = { layer: 'power_substation', id: 49049745 }
    expect(isStatusFeature({ sourceLayer: 'power_substation', properties: { id: 49049745 } }, status)).toBe(
      true
    )
    expect(
      isStatusFeature({ sourceLayer: 'power_substation', properties: { osm_id: '49049745' } }, status)
    ).toBe(true)
    expect(isStatusFeature({ sourceLayer: 'power_plant', properties: { id: 49049745 } }, status)).toBe(false)
    expect(isStatusFeature({ sourceLayer: 'power_substation', properties: {} }, status)).toBe(false)
  })
})

describe('switching on what draws a feature', () => {
  test("the switcher's entries whose prefix matches a map layer reading the tile layer", () => {
    const styleLayers = [
      { id: 'power_substation', 'source-layer': 'power_substation' },
      { id: 'power_substation_point', 'source-layer': 'power_substation' },
      { id: 'power_line', 'source-layer': 'power_line' },
      { id: 'background' }
    ]
    const entries = [
      { id: 'P', prefix: 'power_' },
      { id: 'T', prefix: 'telecoms_' }
    ]
    expect(switcherLayersFor('power_substation', styleLayers, entries)).toEqual(['P'])
    expect(switcherLayersFor('water_pipeline', styleLayers, entries)).toEqual([])
  })
})
