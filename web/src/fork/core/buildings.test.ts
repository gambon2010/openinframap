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
