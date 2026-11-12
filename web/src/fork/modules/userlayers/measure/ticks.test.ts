import { describe, expect, test } from 'vitest'
import { groundDistance } from '../../../core/geo.ts'
import {
  formatTick,
  fromMercator,
  metresPerPixel,
  niceAtLeast,
  readableAngle,
  tickSteps,
  ticksAlong,
  toMercator
} from './ticks.ts'

describe('the steps between marks', () => {
  test('round numbers', () => {
    expect(niceAtLeast(3)).toBe(5)
    expect(niceAtLeast(5)).toBe(5)
    expect(niceAtLeast(5.1)).toBe(10)
  })

  test('one plain mark halfway, on a full value; none for a step of 5', () => {
    expect(tickSteps(2.5)).toEqual({ major: 200, minor: 100 }) // 150 m at 60 px: 200
    expect(tickSteps(10)).toEqual({ major: 1000, minor: 500 }) // 600 m: 1 km
    expect(tickSteps(5)).toEqual({ major: 500, minor: null }) // 300 m: 500
    // Zoomed in a lot: never under 10 m.
    expect(tickSteps(0.01)).toEqual({ major: 10, minor: 5 })
  })

  test('labels: km and m when zoomed in, whole km when not', () => {
    expect(formatTick(18450, 50)).toBe('18 km 450 m')
    expect(formatTick(18000, 200)).toBe('18 km')
    expect(formatTick(800, 100)).toBe('800 m')
    expect(formatTick(18000, 2000)).toBe('18 km')
    expect(formatTick(1200000, 100000)).toBe('1,200 km')
  })

  test('text along a line is never upside down', () => {
    expect(readableAngle(0)).toBe(0)
    expect(readableAngle(180)).toBe(0)
    expect(readableAngle(-170)).toBe(10)
    expect(readableAngle(100)).toBe(-80)
  })

  test('Web Mercator there and back', () => {
    const [lng, lat] = fromMercator(toMercator([7.3, 47.75]))
    expect(lng).toBeCloseTo(7.3, 9)
    expect(lat).toBeCloseTo(47.75, 9)
  })
})

describe('marks along a path', () => {
  // About 22 km, two legs.
  const path: [number, number][] = [
    [7.0, 47.7],
    [7.1, 47.8],
    [7.2, 47.8]
  ]
  const length = groundDistance(path[0], path[1]) + groundDistance(path[1], path[2])

  test('from the start (marked), across legs; labelled at the major ones', () => {
    const zoom = 11
    const { major, minor } = tickSteps(metresPerPixel(47.75, zoom))
    const features = ticksAlong(path, { zoom })
    const marks = features.filter((f) => f.properties?.tick)
    expect(marks).toHaveLength(Math.floor(length / (minor ?? major)) + 1)
    expect(marks[0].properties?.tick).toBe('major')
    const labels = features.filter((f) => f.properties?.tickLabel).map((f) => f.properties!.tickLabel)
    expect(labels).toHaveLength(Math.floor(length / major))
    expect(labels[0]).toBe(formatTick(major, major))
  })

  test('each mark crosses the line, a few pixels each side, square to it on screen', () => {
    const zoom = 14
    const line: [number, number][] = [
      [7.0, 47.7],
      [7.05, 47.72]
    ]
    const [a, b] = line.map(toMercator)
    for (const f of ticksAlong(line, { zoom }).filter((f) => f.properties?.tick)) {
      const [p, q] = (f.geometry as GeoJSON.LineString).coordinates.map((c) =>
        toMercator(c as [number, number])
      )
      // Its middle is on the line.
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
      const cross = (b[0] - a[0]) * (mid[1] - a[1]) - (b[1] - a[1]) * (mid[0] - a[0])
      expect((Math.abs(cross) / Math.hypot(b[0] - a[0], b[1] - a[1])) * 512 * 2 ** zoom).toBeLessThan(0.5)
      // Square to it.
      const dot = (q[0] - p[0]) * (b[0] - a[0]) + (q[1] - p[1]) * (b[1] - a[1])
      const cos = dot / (Math.hypot(q[0] - p[0], q[1] - p[1]) * Math.hypot(b[0] - a[0], b[1] - a[1]))
      // (Square to the great circle, which bends a hair away from the chord a-b.)
      expect(Math.abs(cos)).toBeLessThan(1e-3)
      const px = Math.hypot(q[0] - p[0], q[1] - p[1]) * 512 * 2 ** zoom
      expect(px).toBeGreaterThan(7)
      expect(px).toBeLessThan(15)
    }
  })

  test('zoomed out so the line is short on screen: no marks', () => {
    expect(ticksAlong(path, { zoom: 5 })).toEqual([])
  })

  test('zoomed in on a long line: only the marks in view', () => {
    // A meridian: its great circle is the line itself.
    const long: [number, number][] = [
      [5, 40],
      [5, 50]
    ]
    const bounds = { west: 4.99, east: 5.01, south: 44.99, north: 45.01 }
    const marks = ticksAlong(long, { zoom: 17, bounds }).filter((f) => f.properties?.tick)
    expect(marks.length).toBeGreaterThan(5)
    expect(marks.length).toBeLessThan(400)
  })

  test('a line far too long for its scale: no marks rather than millions', () => {
    const long: [number, number][] = [
      [0, 0],
      [170, 0]
    ]
    expect(ticksAlong(long, { zoom: 20 })).toEqual([])
  })
})

describe('the rule: marks 60 to 150 px apart at every zoom; none only for a tiny line', () => {
  // About 17.6 km, two legs (the measurement that lost its marks).
  const route: [number, number][] = [
    [7.255, 48.632],
    [7.396, 48.7],
    [7.43, 48.665]
  ]
  const length = groundDistance(route[0], route[1]) + groundDistance(route[1], route[2])

  test('at every zoom from 6 to 18', () => {
    for (let zoom = 6; zoom <= 18; zoom += 0.1) {
      const mpp = metresPerPixel(48.66, zoom)
      const { major } = tickSteps(mpp)
      const spacing = major / mpp
      if (major > 10) {
        expect(spacing).toBeGreaterThanOrEqual(60)
        expect(spacing).toBeLessThan(150)
      }
      const labels = ticksAlong(route, { zoom }).filter((f) => f.properties?.tickLabel).length
      // Two steps or more: marks (labels at each step after the start).
      if (length >= 2 * major) expect(labels, `zoom ${zoom.toFixed(1)}`).toBeGreaterThanOrEqual(2)
      else expect(labels, `zoom ${zoom.toFixed(1)}`).toBe(0)
    }
  })

  test('the zooms where it lost its marks now have them', () => {
    for (const zoom of [10.0, 10.5, 11.0, 11.3])
      expect(
        ticksAlong(route, { zoom }).filter((f) => f.properties?.tickLabel).length
      ).toBeGreaterThanOrEqual(2)
  })
})
