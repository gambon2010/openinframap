import { describe, expect, test } from 'vitest'
import type { MapGeoJSONFeature } from 'maplibre-gl'
import { describeFeatures, scaleText } from './info.ts'

describe('debug info', () => {
  test('scale: 1:N in the OGC pixel (0.28 mm), 3 significant digits', () => {
    expect(scaleText(15.68)).toBe('1:56 000')
    expect(scaleText(0.28)).toBe('1:1 000')
  })

  test('features under the pointer: style layer, tile layer, id; a long list cut', () => {
    const f = (layer: string, sourceLayer: string, id: number) =>
      ({ layer: { id: layer }, sourceLayer, properties: { osm_id: id } }) as unknown as MapGeoJSONFeature
    expect(describeFeatures([f('power_line_1', 'power_line', 42)])).toEqual(['power_line_1 (power_line) #42'])
    const many = Array.from({ length: 9 }, (_, i) => f('x', 'x', i))
    const lines = describeFeatures(many)
    expect(lines).toHaveLength(7)
    expect(lines[6]).toBe('… 3 more')
  })
})
