import { describe, expect, it } from 'vitest'
import { alignedHandOvers, tilesShownFrom } from './tile-zooms.ts'

const vector = (source: unknown) => source !== 'raster'

describe('hand-overs between layers at a zoom', () => {
  it('go where that zoom’s tiles start showing, half a zoom before', () => {
    expect(tilesShownFrom(15)).toBe(14.5)
  })

  it('of the same data at a whole zoom: both moved there', () => {
    const moved = alignedHandOvers(
      [
        { id: 'label_low', source: 'power', 'source-layer': 'power_line', minzoom: 5, maxzoom: 10 },
        { id: 'label', source: 'power', 'source-layer': 'power_line', minzoom: 10 },
        // Other data starting at 10: not a hand-over.
        { id: 'water', source: 'water', 'source-layer': 'plant', minzoom: 10 },
        // Already at a tile switch, or raster tiles (not rounded alike): left.
        { id: 'trams', source: 'basemap', 'source-layer': 'railways', maxzoom: 11.5 },
        { id: 'lanes', source: 'basemap', 'source-layer': 'railways', minzoom: 11.5 },
        { id: 'photos_low', source: 'raster', maxzoom: 12 },
        { id: 'photos', source: 'raster', minzoom: 12 }
      ],
      vector
    )
    expect([...moved.entries()]).toEqual([
      ['label_low', { maxzoom: 9.5 }],
      ['label', { minzoom: 9.5 }]
    ])
  })
})
