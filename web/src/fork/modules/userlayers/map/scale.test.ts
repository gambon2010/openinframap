import { describe, expect, test } from 'vitest'
import { dotColour, dotZoom, zoomFactor } from './scale.ts'

describe("a layer's symbols to scale", () => {
  test('not scaled: the same size at every zoom', () => {
    expect(zoomFactor(undefined, 5)).toBe(1)
    expect(zoomFactor(undefined, 18)).toBe(1)
  })

  test('half the size a zoom level out, double a level in, as set at its own zoom', () => {
    expect(zoomFactor(14, 14)).toBe(1)
    expect(zoomFactor(14, 13)).toBe(0.5)
    expect(zoomFactor(14, 15)).toBe(2)
  })

  test('zoomed in, they stop growing at 8 times their size', () => {
    expect(zoomFactor(14, 17)).toBe(8)
    expect(zoomFactor(14, 20)).toBe(8)
  })

  test('dots from two zoom levels out (a quarter of their size)', () => {
    expect(dotZoom(14)).toBe(12)
  })

  test("a dot in its identity's colour, else the item's own", () => {
    expect(dotColour({ kind: 'symbol', sidc: 'SHGPUCI--------' })).toBe('#ff8080')
    expect(dotColour({ kind: 'marker', color: '#123456' })).toBe('#123456')
  })
})
