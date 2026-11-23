import { describe, expect, test } from 'vitest'
import {
  fit,
  formatScale,
  infoBox,
  infoWidth,
  mapBox,
  metresPerPixel,
  pageSize,
  printRatio,
  printedArea,
  scaleBar,
  scaleOf
} from './layout.ts'

describe('the page', () => {
  test('paper sizes', () => {
    expect(pageSize('a4', 'landscape')).toEqual({ w: 297, h: 210 })
    expect(pageSize('a3', 'portrait')).toEqual({ w: 297, h: 420 })
  })

  test('the map fills the page but quarter-inch margins', () => {
    const box = mapBox(pageSize('a4', 'landscape'))
    expect(box.x).toBe(6.35)
    expect(box.w).toBeCloseTo(284.3, 5)
    expect(box.h).toBeCloseTo(197.3, 5)
  })

  test("the box sits in the map's bottom-right corner, about a fifth of the page wide", () => {
    const map = mapBox(pageSize('a4', 'landscape'))
    expect(infoWidth(pageSize('a4', 'landscape'))).toBe(59)
    expect(infoWidth(pageSize('a4', 'portrait'))).toBe(55)
    expect(infoWidth(pageSize('a3', 'landscape'))).toBe(75)
    const box = infoBox(map, 59, 40)
    expect(box.x + box.w).toBe(map.x + map.w)
    expect(box.y + box.h).toBe(map.y + map.h)
  })

  test('an image fitted in a box keeps its shape', () => {
    const box = fit({ x: 0, y: 0, w: 200, h: 100 }, 1000, 1000)
    expect(box).toEqual({ x: 50, y: 0, w: 100, h: 100 })
  })
})

describe('what is printed of the screen', () => {
  test("the paper's shape, as big as fits, a little in from the edges, centred", () => {
    const map = mapBox(pageSize('a4', 'landscape'))
    // A wide screen: as tall as fits, centred across.
    const area = printedArea(1432, 732, map)
    expect(area.h).toBe(700)
    expect(Math.abs(area.w - (700 * map.w) / map.h)).toBeLessThanOrEqual(1)
    expect(Math.abs(area.x + area.w / 2 - 716)).toBeLessThanOrEqual(1)
    // Portrait paper on the same screen: narrower.
    expect(printedArea(1432, 732, mapBox(pageSize('a4', 'portrait'))).w).toBeLessThan(area.w)
  })

  test('drawn sharp enough for 300 dpi, within what the graphics card can draw', () => {
    const map = mapBox(pageSize('a4', 'landscape'))
    const area = { x: 0, y: 0, w: 1000, h: 697 }
    // 284.3 mm at 300 dpi: 3358 px for 1000 px.
    expect(printRatio(area, { w: 1400, h: 900 }, map, 8192)).toBeCloseTo(3.358, 2)
    // A small card: as much as it can draw.
    expect(printRatio(area, { w: 1400, h: 900 }, map, 4096)).toBeCloseTo(4096 / 1400, 3)
    expect(printRatio(area, { w: 1400, h: 900 }, map, 1000)).toBe(1)
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
