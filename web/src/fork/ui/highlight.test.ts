import { describe, expect, it } from 'vitest'
import type { Map, MapGeoJSONFeature } from 'maplibre-gl'
import { FeatureHighlight } from './highlight.ts'

/** A square from x0 to x1 (degrees), 0 to 1 high. */
const square = (x0: number, x1: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, 0],
      [x1, 0],
      [x1, 1],
      [x0, 1],
      [x0, 0]
    ]
  ]
})

describe('a highlighted area cut by the tiles', () => {
  it('is one outline, gathered by the tile id when it has no OSM id (a base the build made)', () => {
    const asked: unknown[] = []
    // Two tiles' pieces of the same area, overlapping a little as tiles do.
    const map = {
      on: () => undefined,
      querySourceFeatures: (_source: string, options: { filter: unknown }) => {
        asked.push(options.filter)
        return [{ geometry: square(0, 1.01) }, { geometry: square(1, 2) }]
      }
    } as unknown as Map
    const highlight = Object.create(FeatureHighlight.prototype) as FeatureHighlight
    highlight._map = map
    const clicked = {
      id: 7,
      source: 'sites',
      sourceLayer: 'sites_area',
      layer: { id: 'sites_military_area' },
      properties: {},
      geometry: square(0, 1.01)
    } as unknown as MapGeoJSONFeature
    const pieces = highlight.allPieces(clicked)
    expect(asked).toEqual([['==', ['id'], 7]])
    expect(pieces).toHaveLength(1)
    expect(pieces[0].geometry.type).toBe('Polygon')
  })
})
