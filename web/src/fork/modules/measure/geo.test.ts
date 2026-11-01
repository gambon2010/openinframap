import { describe, expect, test } from 'vitest'
import {
  area,
  bearing,
  circle,
  destination,
  distance,
  formatArea,
  formatBearing,
  formatDistance,
  parseDistances,
  pathLength
} from './geo.ts'

describe('on the sphere', () => {
  test('distances: a degree of latitude, Paris–London', () => {
    expect(distance([7, 47], [7, 48])).toBeCloseTo(111195, -1)
    expect(distance([2.3522, 48.8566], [-0.1276, 51.5072]) / 1000).toBeCloseTo(343.5, 0)
    expect(
      pathLength([
        [7, 47],
        [7, 48],
        [7, 49]
      ])
    ).toBeCloseTo(2 * 111195, -1)
  })

  test('area: a 1 km square near the equator, closed or not', () => {
    const d = 1000 / 111195
    const square: [number, number][] = [
      [0, 0],
      [d, 0],
      [d, d],
      [0, d]
    ]
    expect(area(square)).toBeCloseTo(1e6, -3)
    expect(area([...square, square[0]])).toBeCloseTo(1e6, -3)
    expect(area(square.slice(0, 2))).toBe(0)
  })

  test('bearings and destinations', () => {
    expect(bearing([7, 47], [7, 48])).toBeCloseTo(0, 5)
    expect(bearing([7, 47], [8, 47])).toBeCloseTo(89.6, 0)
    expect(bearing([7, 47], [7, 46])).toBeCloseTo(180, 5)
    const [lng, lat] = destination([7, 47], 10000, 90)
    expect(distance([7, 47], [lng, lat])).toBeCloseTo(10000, 0)
  })

  test('a circle: closed, every point at the radius', () => {
    const ring = circle([7, 47], 5000, 32)
    expect(ring).toHaveLength(33)
    expect(ring[0]).toEqual(ring[32])
    for (const p of ring) expect(distance([7, 47], p)).toBeCloseTo(5000, 0)
  })
})

describe('written for people', () => {
  test('distances, areas, bearings', () => {
    expect(formatDistance(850.4)).toBe('850 m')
    expect(formatDistance(1234)).toBe('1.23 km')
    expect(formatDistance(12345)).toBe('12.3 km')
    expect(formatDistance(123456)).toBe('123 km')
    expect(formatDistance(5000)).toBe('5 km')
    expect(formatDistance(1284000)).toBe('1,284 km')
    expect(formatArea(4096.1e9)).toBe('4,096,100 km²')
    expect(formatArea(450)).toBe('450 m²')
    expect(formatArea(32000)).toBe('3.2 ha')
    expect(formatArea(12.5e6)).toBe('12.5 km²')
    expect(formatBearing(47)).toBe('047° (836 mils)')
    expect(formatBearing(359.8)).toBe('000° (6396 mils)')
  })

  test('range ring distances as typed', () => {
    expect(parseDistances('1, 5, 10 km')).toEqual([1000, 5000, 10000])
    expect(parseDistances('500 m, 2.5km')).toEqual([500, 2500])
    expect(parseDistances('3 nm')).toEqual([5556])
    expect(parseDistances('2 5')).toEqual([2000, 5000])
    expect(parseDistances('10 km 5 km')).toEqual([5000, 10000])
    expect(parseDistances('none')).toEqual([])
  })
})
