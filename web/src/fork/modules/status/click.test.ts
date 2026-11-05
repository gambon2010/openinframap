import { describe, expect, test } from 'vitest'
import { isStatusFeature } from './click.ts'

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
