import { describe, expect, test } from 'vitest'
import { heightPlace } from './details.ts'

describe('where a clicked thing’s height is read', () => {
  test('a point: itself', () => {
    expect(heightPlace({ type: 'Point', coordinates: [5.7, 45.2] })).toEqual({
      lng: 5.7,
      lat: 45.2,
      middle: false
    })
  })

  test('an area: the middle of its box', () => {
    const square = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0]
        ]
      ]
    }
    expect(heightPlace(square)).toEqual({ lng: 1, lat: 1, middle: true })
  })

  test('an area whose middle is outside it (a ring round a courtyard): none', () => {
    const ring = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0]
        ],
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
          [1, 1]
        ]
      ]
    }
    expect(heightPlace(ring)).toBeNull()
  })

  test('a line: none (its heights are a profile)', () => {
    expect(
      heightPlace({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1]
        ]
      })
    ).toBeNull()
  })
})
