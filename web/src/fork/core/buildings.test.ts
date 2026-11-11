import { describe, expect, test } from 'vitest'
import { joinPieces } from './buildings.ts'

const box = (w: number, s: number, e: number, n: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s]
    ]
  ]
})

describe('buildings', () => {
  test('a building cut at tile edges is one outline again (the pieces overlap a little)', () => {
    const joined = joinPieces([box(0, 0, 1.1, 1), box(0.9, 0, 2, 1), box(0, 0.9, 2, 2)])!
    expect(joined.type).toBe('Polygon')
    const ring = (joined as GeoJSON.Polygon).coordinates[0]
    expect(ring).toHaveLength(5) // a square again: no seams left
  })

  test('apart pieces stay apart; one piece is itself; none is nothing', () => {
    expect(joinPieces([box(0, 0, 1, 1), box(3, 0, 4, 1)])!.type).toBe('MultiPolygon')
    expect(joinPieces([box(0, 0, 1, 1)])).toEqual({
      type: 'Polygon',
      coordinates: box(0, 0, 1, 1).coordinates
    })
    expect(joinPieces([{ type: 'Point', coordinates: [0, 0] }])).toBeNull()
  })
})

describe('a building on the ground', () => {
  test('its area, a courtyard taken out', async () => {
    const { outlineArea } = await import('./buildings.ts')
    // About 100 m × 100 m at 48.86° N, with a 50 m × 50 m courtyard.
    const dLat = 100 / 111_195
    const dLng = dLat / Math.cos((48.86 * Math.PI) / 180)
    const square = (w: number, s: number, size: number) => [
      [w, s],
      [w + dLng * size, s],
      [w + dLng * size, s + dLat * size],
      [w, s + dLat * size],
      [w, s]
    ]
    const solid = outlineArea({ type: 'Polygon', coordinates: [square(2.33, 48.86, 1)] })
    expect(solid).toBeGreaterThan(9_900)
    expect(solid).toBeLessThan(10_100)
    const courtyard = outlineArea({
      type: 'Polygon',
      coordinates: [square(2.33, 48.86, 1), square(2.33 + dLng / 4, 48.86 + dLat / 4, 0.5)]
    })
    expect(Math.round(courtyard / 100)).toBe(75)
  })

  test('a clickable area: an invisible fill under its outline, both found by a prefix', async () => {
    const { clickableArea } = await import('./map-style.ts')
    const [hit, outline] = clickableArea(
      'buildings_outline',
      { source: 'basemap', sourceLayer: 'buildings', minzoom: 15 },
      -10,
      {
        'line-color': '#000'
      }
    )
    expect(hit).toMatchObject({
      id: 'buildings_outline_hit',
      type: 'fill',
      minzoom: 15,
      paint: { 'fill-opacity': 0 }
    })
    expect(outline).toMatchObject({ id: 'buildings_outline', type: 'line', 'source-layer': 'buildings' })
    expect(outline.zorder).toBeGreaterThan(hit.zorder)
  })
})
