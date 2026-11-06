// The geometry helpers of My layers: control points of graphics, moving the points
// of lines and areas, and the selection's handles.
import { describe, expect, test } from 'vitest'
import { MAX_SIZE, MIN_SIZE } from './render.constants.ts'
import {
  controlPoints,
  geometryCentre,
  moveVertex,
  resizable,
  selectionFeatures,
  sizeFromDrag,
  translateGeometry,
  vertices,
  visibleBox,
  scaledBox
} from './geometry.ts'
import { withoutMinZoom } from './layers.ts'
import { dropRepeats, graphicGeometry, wheelPixels } from './tools.ts'
import { UserFeature } from '../model/model.ts'

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

  test('a graphic: only its handles (it glows under its own lines)', () => {
    const out = selectionFeatures(feature(line, 'graphic'))
    expect(out.every((f) => f.properties?.vertex)).toBe(true)
    expect(out).toHaveLength(3)
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

describe('copy and paste', () => {
  test('a geometry moved by an amount', () => {
    expect(translateGeometry({ type: 'Point', coordinates: [1, 2] }, 0.5, -1)).toEqual({
      type: 'Point',
      coordinates: [1.5, 1]
    })
    const moved = translateGeometry(square, 10, 20) as GeoJSON.Polygon
    expect(moved.coordinates[0][2]).toEqual([11, 21])
    expect(square.coordinates[0][2]).toEqual([1, 1]) // the original is left alone
  })

  test('the centre of a geometry', () => {
    expect(geometryCentre(square)).toEqual([0.5, 0.5])
    expect(geometryCentre(line)).toEqual([1, 0.5])
    expect(geometryCentre({ type: 'Point', coordinates: [3, 4] })).toEqual([3, 4])
  })

  test('pasting at a point: the centre lands there', () => {
    const [cx, cy] = geometryCentre(line)
    const pasted = translateGeometry(line, 5 - cx, 5 - cy)
    expect(geometryCentre(pasted)).toEqual([5, 5])
  })
})

describe("an image's visible part", () => {
  // 4×4, one visible pixel block at x 2..3, y 1..2.
  const rgba = new Uint8Array(4 * 4 * 4)
  for (const [x, y] of [
    [2, 1],
    [3, 1],
    [2, 2],
    [3, 2]
  ])
    rgba[(y * 4 + x) * 4 + 3] = 255

  test('the box around the pixels drawn, from the centre', () => {
    expect(visibleBox(rgba, 4, 4)).toEqual({ left: 0, top: -1, right: 2, bottom: 1 })
    expect(visibleBox(rgba, 4, 4, 2)).toEqual({ left: 0, top: -0.5, right: 1, bottom: 0.5 })
  })

  test('nothing visible: the whole image', () => {
    expect(visibleBox(new Uint8Array(64), 4, 4)).toEqual({ left: -2, top: -2, right: 2, bottom: 2 })
  })
})

describe('copies at every zoom', () => {
  test("the original's minimum zooms are left out, its other conditions kept", () => {
    const filter = [
      'any',
      ['all', ['>', ['get', 'output'], 750], ['>', ['zoom'], 5]],
      ['all', ['<', ['get', 'area'], 100], ['<', ['zoom'], 16]],
      ['<=', 9, ['zoom']]
    ]
    expect(withoutMinZoom(filter)).toEqual([
      'any',
      ['all', ['>', ['get', 'output'], 750], true],
      ['all', ['<', ['get', 'area'], 100], ['<', ['zoom'], 16]],
      true
    ])
  })
})

describe('Shift + scroll', () => {
  test('wheel steps in pixels: lines and pages turned into pixels, either axis', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: -100, deltaMode: 0 })).toBe(-100)
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe(120)
    expect(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toBe(400)
    expect(wheelPixels({ deltaX: 50, deltaY: 0, deltaMode: 0 })).toBe(50)
  })
})

describe('the selection box around an image', () => {
  test('scaled, and padded each side', () => {
    const box = { left: -10, top: -5, right: 10, bottom: 5 }
    expect(scaledBox(box, 2)).toEqual({ left: -20, top: -10, right: 20, bottom: 10 })
    expect(scaledBox(box, 1, 4)).toEqual({ left: -14, top: -9, right: 14, bottom: 9 })
  })
})
