import { describe, expect, test } from 'vitest'
import { areaCrossesItself, pathCrossesItself, segmentsMeet, pointOf, positionsOf } from './shapes.ts'

describe('impossible areas', () => {
  const square: [number, number][] = [
    [7.0, 47.0],
    [7.1, 47.0],
    [7.1, 47.1],
    [7.0, 47.1]
  ]

  test('a square is fine; the same points in bow-tie order are not', () => {
    expect(areaCrossesItself(square)).toBe(false)
    expect(areaCrossesItself([square[0], square[2], square[1], square[3]])).toBe(true)
  })

  test('the screenshot: drawn top left, top right, bottom left, bottom right', () => {
    const z: [number, number][] = [
      [6.88, 48.08],
      [7.13, 48.08],
      [6.99, 47.9],
      [7.2, 47.9]
    ]
    // The path drawn so far doesn't cross; closing it would.
    expect(pathCrossesItself(z)).toBe(false)
    expect(areaCrossesItself(z)).toBe(true)
  })

  test('a concave shape (a C) is fine', () => {
    const c: [number, number][] = [
      [0, 0],
      [3, 0],
      [3, 1],
      [1, 1],
      [1, 2],
      [3, 2],
      [3, 3],
      [0, 3]
    ]
    expect(areaCrossesItself(c)).toBe(false)
  })

  test('a path that doubles back over itself, a point on another edge', () => {
    expect(
      pathCrossesItself([
        [0, 0],
        [2, 0],
        [2, 1],
        [1, -1]
      ])
    ).toBe(true)
    expect(segmentsMeet([0, 0], [2, 0], [1, 0], [1, 1])).toBe(true)
    expect(segmentsMeet([0, 0], [1, 0], [2, 0], [3, 0])).toBe(false)
  })

  test('three points can always make an area', () => {
    expect(areaCrossesItself(square.slice(0, 3))).toBe(false)
  })
})

describe('positions', () => {
  test('every position of a geometry, a collection too', () => {
    const square: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0]
        ]
      ]
    }
    expect(positionsOf(square)).toHaveLength(4)
    expect(positionsOf({ type: 'Point', coordinates: [5, 6] })).toEqual([[5, 6]])
    expect(
      positionsOf({
        type: 'GeometryCollection',
        geometries: [square, { type: 'Point', coordinates: [5, 6] }]
      })
    ).toHaveLength(5)
    expect(pointOf({ geometry: { type: 'Point', coordinates: [5, 6] } })).toEqual([5, 6])
  })
})
