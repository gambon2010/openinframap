// Tactical graphics through the real C5ISR renderer (no map needed: it returns GeoJSON).
import { beforeAll, describe, expect, test } from 'vitest'
import {
  axisControlPoints,
  axisWidthPoint,
  colour,
  axisWidth,
  graphicsLibrary,
  haloFor,
  isAxis,
  mapScale,
  pathLength,
  pointCount,
  renderGraphic,
  toDCode
} from './graphics.ts'

type Lib = Awaited<ReturnType<typeof graphicsLibrary>>
let lib: Lib

beforeAll(async () => {
  lib = await graphicsLibrary()
}, 60_000)

describe('helpers', () => {
  test('colours: alpha dropped, lower case', () => {
    expect(colour('#FF00FF00')).toBe('#00ff00')
    expect(colour('#FFFF00')).toBe('#ffff00')
    expect(colour('red')).toBeNull()
    expect(colour(undefined)).toBeNull()
  })

  test('labels get a dark outline on light text, white on dark', () => {
    expect(haloFor('#ffff00')).toBe('#1a1a1a') // yellow: unknown / pending
    expect(haloFor('#00ffff')).toBe('#1a1a1a')
    expect(haloFor('#000000')).toBe('#ffffff')
    expect(haloFor('#ff0000')).toBe('#ffffff') // hostile red
    expect(haloFor('#0000ff')).toBe('#ffffff')
  })

  test('map scale halves with each zoom level', () => {
    expect(mapScale(10, 0) / mapScale(11, 0)).toBeCloseTo(2)
    expect(mapScale(10, 60)).toBeCloseTo(mapScale(10, 0) / 2, 0)
  })
})

describe('the renderer', () => {
  test('2525C codes convert to 2525D', () => {
    expect(toDCode(lib, 'GFGPOLAGM------')).toMatch(/^\d{20,30}$/)
    expect(toDCode(lib, 'GFGPXXXXXX-----')).toBeNull()
  })

  test('how many points a graphic takes', () => {
    expect(pointCount(lib, 'GFTPB----------')).toEqual({ min: 3, max: 3 }) // block
    expect(pointCount(lib, 'GFGPGLP--------')?.min).toBe(2) // phase line
  })

  test('a phase line: lines and its label', () => {
    const features = renderGraphic(lib, {
      sidc: 'GFGPGLP--------',
      points: [
        [7.6, 48.6],
        [7.9, 48.62]
      ],
      modifiers: { T: 'RED' },
      scale: mapScale(11, 48.6)
    })
    const lines = features.filter((f) => f.geometry.type.endsWith('LineString'))
    const labels = features.filter((f) => f.geometry.type === 'Point').map((f) => f.properties?.label)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0].properties?.stroke).toMatch(/^#[0-9a-f]{6}$/)
    expect(labels.join(' ')).toContain('RED')
    // The metadata polygon isn't drawn.
    expect(features.every((f) => !('symbolID' in (f.properties ?? {})))).toBe(true)
  })

  test('an axis of advance with a colour of our own', () => {
    const features = renderGraphic(lib, {
      sidc: 'GHGPOLAGM------',
      points: [
        [7.6, 48.5],
        [7.7, 48.55],
        [7.72, 48.5]
      ],
      color: '#123456',
      scale: mapScale(11, 48.5)
    })
    expect(features.some((f) => f.properties?.stroke === '#123456')).toBe(true)
  })

  test('a code without an equivalent is an error', () => {
    expect(() => renderGraphic(lib, { sidc: 'GFGPXXXXXX-----', points: [[0, 0]], scale: 50_000 })).toThrow()
  })
})

describe('arrows (axis of advance, attacks)', () => {
  // A path from tail to tip, eastwards along 48.5°N: about 3.7 km.
  const path: [number, number][] = [
    [7.6, 48.5],
    [7.65, 48.5]
  ]

  test('which graphics are arrows', () => {
    expect(isAxis(lib, 'GHGPOLAGM------')).toBe(true) // main attack
    expect(isAxis(lib, 'GFGPOLAGS------')).toBe(true) // supporting attack
    expect(isAxis(lib, 'GFGPGLP--------')).toBe(false) // phase line
  })

  test('the width follows the length', () => {
    expect(pathLength(path)).toBeCloseTo(3687, -1)
    expect(axisWidth(path)).toBe(Math.round(pathLength(path) / 5))
    expect(axisWidth([path[0], path[0]])).toBe(10)
  })

  test('the arrowhead corner is behind the tip, to its left', () => {
    const corner = axisWidthPoint(path, axisWidth(path))
    expect(corner[0]).toBeLessThan(path[1][0])
    expect(corner[1]).toBeGreaterThan(path[1][1])
  })

  test("the renderer's points: tip first, back to the tail, then the width point", () => {
    const bent: [number, number][] = [
      [7.6, 48.5],
      [7.62, 48.51],
      [7.65, 48.5]
    ]
    const points = axisControlPoints(bent)
    expect(points.slice(0, 3)).toEqual([...bent].reverse())
    expect(points[3]).toEqual(axisWidthPoint(bent, axisWidth(bent)))
  })

  test('the same path always gives the same arrow; a longer one a proportionally wider one', () => {
    expect(axisControlPoints(path)).toEqual(axisControlPoints(path))
    const longer: [number, number][] = [path[0], [7.7, 48.5]]
    expect(axisWidth(longer) / axisWidth(path)).toBeCloseTo(2, 1)
  })

  test('drawn from those points', () => {
    const features = renderGraphic(lib, {
      sidc: 'GHGPOLAGM------',
      points: axisControlPoints(path),
      scale: mapScale(13, 48.5)
    })
    expect(features.some((f) => f.geometry.type.endsWith('LineString'))).toBe(true)
  })
})
