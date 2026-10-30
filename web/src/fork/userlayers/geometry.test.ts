// The geometry helpers of My layers: control points of graphics, moving the points
// of lines and areas, and the selection's handles.
import { describe, expect, test } from 'vitest'
import {
  MAX_SIZE,
  MIN_SIZE,
  controlPoints,
  moveVertex,
  resizable,
  selectionFeatures,
  sizeFromDrag,
  vertices
} from './render.ts'
import { dropRepeats, graphicGeometry } from './tools.ts'
import { UserFeature } from './model.ts'

const line: GeoJSON.LineString = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [1, 1],
    [2, 0]
  ]
}
const square: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0]
    ]
  ]
}

describe('graphics', () => {
  test('control points stored as a line, or one point', () => {
    expect(graphicGeometry([[1, 2]])).toEqual({ type: 'MultiPoint', coordinates: [[1, 2]] })
    expect(graphicGeometry(line.coordinates as [number, number][])).toEqual(line)
    expect(controlPoints(graphicGeometry([[1, 2]]))).toEqual([[1, 2]])
    expect(controlPoints(line)).toEqual(line.coordinates)
  })

  test('a double-click adds the same point twice: only one is kept', () => {
    expect(
      dropRepeats([
        [0, 0],
        [1, 1],
        [1, 1],
        [2, 2],
        [1, 1]
      ])
    ).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [1, 1]
    ])
  })
})

describe('moving points', () => {
  test('a polygon has no handle on its closing point', () => {
    expect(vertices(square)).toHaveLength(4)
    expect(vertices(line)).toHaveLength(3)
    expect(vertices({ type: 'Point', coordinates: [0, 0] })).toEqual([])
  })

  test('moving a line point', () => {
    expect(moveVertex(line, 1, [5, 5])).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [5, 5],
        [2, 0]
      ]
    })
  })

  test("moving a polygon's first point moves its closing point too", () => {
    const moved = moveVertex(square, 0, [-1, -1]) as GeoJSON.Polygon
    expect(moved.coordinates[0][0]).toEqual([-1, -1])
    expect(moved.coordinates[0][4]).toEqual([-1, -1])
    expect(moved.coordinates[0][2]).toEqual([1, 1])
  })

  test('the original is left alone', () => {
    moveVertex(line, 0, [9, 9])
    expect(line.coordinates[0]).toEqual([0, 0])
  })
})

describe('selection', () => {
  const feature = (geometry: GeoJSON.Geometry, kind: UserFeature['properties']['kind']): UserFeature => ({
    type: 'Feature',
    id: 'f',
    geometry,
    properties: { kind }
  })

  test('a symbol: just itself, no handles', () => {
    const out = selectionFeatures(feature({ type: 'Point', coordinates: [0, 0] }, 'symbol'))
    expect(out).toHaveLength(1)
  })

  test('a drawing: its shape and a handle per point', () => {
    const out = selectionFeatures(feature(square, 'drawing'))
    expect(out[0].geometry).toEqual(square)
    expect(out.slice(1).map((f) => f.properties)).toEqual(
      [0, 1, 2, 3].map((index) => ({ vertex: true, index }))
    )
  })

  test('a graphic: the line through its control points, and handles', () => {
    const out = selectionFeatures(feature(line, 'graphic'))
    expect(out[0].geometry).toEqual(line)
    expect(out).toHaveLength(4)
  })
})

describe('resizing pictures, symbols and markers', () => {
  const point = (kind: UserFeature['properties']['kind']): UserFeature => ({
    type: 'Feature',
    id: 'f',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { kind }
  })

  test('which items get a resize handle', () => {
    expect(resizable(point('image'))).toBe(true)
    expect(resizable(point('symbol'))).toBe(true)
    expect(resizable(point('marker'))).toBe(true)
    expect(resizable(point('copy'))).toBe(false)
    expect(resizable({ ...point('drawing'), geometry: line })).toBe(false)
    expect(resizable(null)).toBe(false)
  })

  test('the size follows the distance from the centre', () => {
    expect(sizeFromDrag(45, 45)).toBe(1)
    expect(sizeFromDrag(90, 45)).toBe(2)
    expect(sizeFromDrag(136, 45)).toBe(3) // rounded to steps of 0.05
    expect(sizeFromDrag(1, 45)).toBe(MIN_SIZE)
    expect(sizeFromDrag(10_000, 45)).toBe(MAX_SIZE)
    expect(sizeFromDrag(50, 0)).toBe(1) // no image size known
  })
})
