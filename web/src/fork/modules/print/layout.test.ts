import { describe, expect, test } from 'vitest'
import { fit, formatScale, metresPerPixel, pageLayout, pageSize, scaleBar, scaleOf } from './layout.ts'

describe('the page', () => {
  test('paper sizes', () => {
    expect(pageSize('a4', 'landscape')).toEqual({ w: 297, h: 210 })
    expect(pageSize('a3', 'portrait')).toEqual({ w: 297, h: 420 })
  })

  test('the map leaves room for the legend, when there is one', () => {
    const page = pageSize('a4', 'landscape')
    const withLegend = pageLayout(page, true)
    const without = pageLayout(page, false)
    expect(without.legend).toBeNull()
    expect(without.map.w).toBe(277)
    expect(withLegend.map.w + withLegend.legend!.w + 5).toBe(277)
    expect(withLegend.legend!.x).toBeGreaterThan(withLegend.map.x + withLegend.map.w)
  })

  test('an image fitted in a box keeps its shape', () => {
    const box = fit({ x: 0, y: 0, w: 200, h: 100 }, 1000, 1000)
    expect(box).toEqual({ x: 50, y: 0, w: 100, h: 100 })
  })
})

describe('the scale', () => {
  test('metres per pixel: about 0.3 m at zoom 18 on the equator', () => {
    expect(metresPerPixel(0, 18)).toBeCloseTo(0.2986, 3)
    expect(metresPerPixel(60, 18)).toBeCloseTo(0.1493, 3)
  })

  test('on paper', () => {
    // 1000 px at 0.2986 m/px = 298.6 m on 100 mm: 1:2986.
    expect(scaleOf(0, 18, 1000, 100)).toBeCloseTo(2986, 0)
    expect(formatScale(2986)).toBe('1:3 000')
    expect(formatScale(24612)).toBe('1:25 000')
    expect(formatScale(84)).toBe('1:84')
  })

  test('a round scale bar that fits', () => {
    expect(scaleBar(25000, 40)).toEqual({ metres: 1000, mm: 40 })
    const bar = scaleBar(30000, 40)
    expect(bar.metres).toBe(1000)
    expect(bar.mm).toBeCloseTo(33.3, 1)
    expect(scaleBar(100000, 40).metres).toBe(2000)
  })
})
