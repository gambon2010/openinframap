// Tactical graphics through the real C5ISR renderer (no map needed: it returns GeoJSON).
import { beforeAll, describe, expect, test } from 'vitest'
import {
  axisControlPoints,
  axisWidthPoint,
  colour,
  axisWidth,
  axisWidthFrom,
  graphicsLibrary,
  haloFor,
  isAxis,
  pathFromAxisPoints,
  mapScale,
  pathLength,
  pointCount,
  renderGraphic,
  isSquare,
  SQUARE,
  squareUp,
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

  test('the size handle sets the width, wherever it is dragged', () => {
    const corner = axisWidthPoint(path, 800)
    expect(axisWidthFrom(path, corner)).toBeCloseTo(800, -1)
    expect(axisWidthFrom(path, path[1])).toBe(10) // on the centre line: the minimum
    expect(axisControlPoints(path, 800)[2]).toEqual(corner)
  })

  test('an old four-point arrow becomes a path, keeping its width', () => {
    const old = axisControlPoints(path, 600) // tip, tail, width point
    const back = pathFromAxisPoints(old)
    expect(back).toEqual(path)
    expect(axisWidthFrom(back, old[old.length - 1])).toBeCloseTo(600, -1)
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

describe('three-point graphics drawn square', () => {
  const metres = ([lon, lat]: number[], [lon0, lat0]: number[]) => [
    (lon - lon0) * 111_320 * Math.cos((lat0 * Math.PI) / 180),
    (lat - lat0) * 110_540
  ]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1]
  const a: [number, number] = [7.7, 48.58]
  const b: [number, number] = [7.74, 48.58]
  const skewed: [number, number] = [7.725, 48.605]

  test('Contain, Block, Clear...: the third point onto the perpendicular through the middle', () => {
    for (const sidc of ['GFTPJ----------', 'GHTPB----------', 'GFTPX----------', 'GFMPBDE--------']) {
      const [p1, p2, p3] = squareUp(sidc, [a, b, skewed])
      expect(p1).toEqual(a)
      expect(p2).toEqual(b)
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      expect(Math.abs(dot(metres(p3, mid), metres(b, a)))).toBeLessThan(1e-6)
      // As far from the base as it was.
      expect(metres(p3, mid)[1]).toBeCloseTo(metres(skewed, mid)[1], 3)
    }
  })

  test('Disrupt: on the perpendicular through one end (the task: the second)', () => {
    const task = squareUp('GFTPT----------', [a, b, skewed])[2]
    expect(Math.abs(dot(metres(task, b), metres(b, a)))).toBeLessThan(1e-6)
    const obstacle = squareUp('GFMPOED--------', [a, b, skewed])[2]
    expect(Math.abs(dot(metres(obstacle, a), metres(b, a)))).toBeLessThan(1e-6)
  })

  // Through the real renderer: whatever each graphic's points mean, once squared up
  // its main stroke (stem, arrows, sides: the longest line not along the base) is at
  // a right angle to the base.
  test.each(Object.keys(SQUARE))('%s drawn square', (key) => {
    const rule = SQUARE[key]
    const sidc = (key.slice(0, 1) + 'F' + key.slice(2, 3) + 'P' + key.slice(4)).padEnd(15, '-')
    const raw: [number, number][] = []
    raw[rule.base[0]] = a
    raw[rule.base[1]] = b
    raw[rule.free] = skewed
    const points = squareUp(sidc, raw)
    const pieces = renderGraphic(lib, { sidc, points, scale: mapScale(13, 48.58) })
    const base = metres(b, a)
    const baseLength = Math.hypot(base[0], base[1])
    let best = { length: 0, cos: 1 }
    for (const piece of pieces) {
      const g = piece.geometry
      const lines =
        g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const d = metres(line[i], line[i - 1])
          const length = Math.hypot(d[0], d[1])
          const cos = Math.abs(dot(d, base)) / (length * baseLength)
          if (cos < Math.cos((10 * Math.PI) / 180) && length > best.length) best = { length, cos }
        }
      }
    }
    expect(best.length).toBeGreaterThan(0)
    // Within a degree of a right angle.
    expect(best.cos).toBeLessThan(Math.sin(Math.PI / 180))
  })

  test('Ambush and attack by fire position: the first point (the arrow tip) moves', () => {
    const [p1, p2, p3] = squareUp('GFGPSLA--------', [skewed, a, b])
    expect([p2, p3]).toEqual([a, b])
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    expect(Math.abs(dot(metres(p1, mid), metres(b, a)))).toBeLessThan(1e-6)
    expect(isSquare('GFGPOAF--------')).toBe(true)
  })

  test('others are left as they are', () => {
    expect(squareUp('GFGPDLP--------', [a, b, skewed])).toEqual([a, b, skewed]) // principal direction of fire
    expect(squareUp('GFTPL----------', [a, b, skewed])).toEqual([a, b, skewed]) // delay
    expect(squareUp('GFTPJ----------', [a, b])).toEqual([a, b]) // still being drawn
    expect(isSquare('GFTPK----------')).toBe(false) // counterattack
  })
})
