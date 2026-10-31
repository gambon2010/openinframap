import { describe, expect, it } from 'vitest'
import type { MapGeoJSONFeature } from 'maplibre-gl'
import { featureId, selection } from './selection.ts'

const feature = (layer: string, properties: Record<string, unknown>) =>
  ({ sourceLayer: layer, properties }) as unknown as MapGeoJSONFeature

describe('selection', () => {
  it('names features by tile layer and id', () => {
    expect(featureId(feature('power_line', { osm_id: 12 }))).toBe('power_line:12')
    expect(featureId(feature('extra_facility', { id: 3 }))).toBe('extra_facility:3')
    expect(featureId(feature('power_line', {}))).toBeNull()
  })

  it('adds and takes out', () => {
    let changes = 0
    selection.onChange(() => changes++)
    const line = feature('power_line', { osm_id: 1 })
    expect(selection.toggle(line)).toBe(true)
    expect(selection.toggle(feature('power_tower', { osm_id: 2 }))).toBe(true)
    expect(selection.features.map(([id]) => id)).toEqual(['power_line:1', 'power_tower:2'])
    selection.toggle(line)
    expect(selection.features.map(([id]) => id)).toEqual(['power_tower:2'])
    expect(selection.toggle(feature('label', {}))).toBe(false)
    selection.clear()
    expect(selection.features).toEqual([])
    expect(changes).toBe(4)
  })
})
