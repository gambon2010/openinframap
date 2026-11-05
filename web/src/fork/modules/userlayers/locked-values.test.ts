// Today's exact results of the calculations being tidied (shared helpers, named
// constants): any change in a number, rounding or unit shows here.
import { describe, expect, test } from 'vitest'
import { axisWidth, axisWidthFrom, axisWidthPoint, mapScale, pathLength } from './graphics/graphics.ts'
import { MAX_SIZE, MIN_SIZE, sizeFromDrag } from './map/render.ts'
import { metresPerPixel as tickMetresPerPixel } from './measure/ticks.ts'

const path: [number, number][] = [
  [7.7, 48.58],
  [7.74, 48.59],
  [7.78, 48.57]
]

describe('locked values', () => {
  test('arrows: length, width, width handle', () => {
    expect(pathLength(path)).toMatchInlineSnapshot(`6829.1203095015035`)
    expect(axisWidth(path)).toMatchInlineSnapshot(`1366`)
    expect(axisWidthPoint(path, 900)).toMatchInlineSnapshot(`
      [
        7.778779990327136,
        48.575699466037065,
      ]
    `)
    expect(axisWidthFrom(path, [7.79, 48.58])).toMatchInlineSnapshot(`2653`)
  })

  test('scales', () => {
    expect(mapScale(13, 48.58)).toMatchInlineSnapshot(`22575.323574245183`)
    expect(tickMetresPerPixel(48.58, 13)).toMatchInlineSnapshot(`6.321090600788651`)
  })

  test('sizes: dragging snaps to 0.05, within the limits', () => {
    expect([MIN_SIZE, MAX_SIZE]).toMatchInlineSnapshot(`
      [
        0.2,
        8,
      ]
    `)
    expect([10, 33, 45, 46, 91, 1000, 0].map((d) => sizeFromDrag(d, 45))).toMatchInlineSnapshot(`
      [
        0.2,
        0.75,
        1,
        1,
        2,
        8,
        0.2,
      ]
    `)
    expect(sizeFromDrag(10, 0)).toMatchInlineSnapshot(`1`)
  })
})
