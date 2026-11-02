import { describe, expect, test } from 'vitest'
import { distance } from './geo.ts'
import { formatTick, metresPerPixel, niceAtLeast, tickSteps, ticksAlong } from './ticks.ts'

describe('the steps between marks', () => {
  test('round numbers', () => {
    expect(niceAtLeast(3)).toBe(5)
    expect(niceAtLeast(5)).toBe(5)
    expect(niceAtLeast(5.1)).toBe(10)
    expect(niceAtLeast(0.03)).toBeCloseTo(0.05)
  })

  test('zoomed out: kilometres apart; zoomed in: never under 10 m; major a multiple of minor', () => {
    for (let zoom = 3; zoom <= 22; zoom++) {
      const mpp = metresPerPixel(48, zoom)
      const { minor, major } = tickSteps(mpp)
      expect(minor).toBeGreaterThanOrEqual(10)
      expect(minor / mpp).toBeGreaterThanOrEqual(15 - 1e-6)
      expect(major / minor).toBeCloseTo(Math.round(major / minor), 9)
      expect(major / mpp).toBeGreaterThanOrEqual(90 - 1e-6)
    }
    expect(tickSteps(metresPerPixel(48, 22)).minor).toBe(10)
    expect(tickSteps(metresPerPixel(48, 6)).major).toBeGreaterThanOrEqual(100000)
  })

  test('labels', () => {
    expect(formatTick(800)).toBe('800 m')
    expect(formatTick(5000)).toBe('5 km')
    expect(formatTick(2500)).toBe('2.5 km')
    expect(formatTick(1200000)).toBe('1,200 km')
  })
})

describe('marks along a path', () => {
  // About 22 km, two legs.
  const path: [number, number][] = [
    [7.0, 47.7],
    [7.1, 47.8],
    [7.2, 47.8]
  ]
  const length = distance(path[0], path[1]) + distance(path[1], path[2])

  test('counted from the start, across legs; labelled at the major ones', () => {
    const zoom = 11
    const { minor, major } = tickSteps(metresPerPixel(47.75, zoom))
    const features = ticksAlong(path, { zoom })
    const marks = features.filter((f) => f.properties?.tick)
    expect(marks).toHaveLength(Math.floor(length / minor))
    const labels = features.filter((f) => f.properties?.tickLabel).map((f) => f.properties!.tickLabel)
    expect(labels).toHaveLength(Math.floor(length / major))
    expect(labels[0]).toBe(formatTick(major))
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
